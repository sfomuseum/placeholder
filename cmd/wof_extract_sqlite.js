const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const whosonfirst = require('pelias-whosonfirst');
const config = require('pelias-config').generate().imports.whosonfirst;
const SQLiteStream = whosonfirst.SQLiteStream;
const through = require('through2');
const Placeholder = require('../Placeholder');
const wof = require('../prototype/wof');
const buildDescendantPopulationIndex = require('../lib/descendantPopulationIndex');

const DESCENDANT_POPULATION_PROPERTY = wof.DESCENDANT_POPULATION_PROPERTY;

const SQLITE_REGEX = /whosonfirst-data-[a-z0-9-]+\.db$/;

// Use WOF_DIR env variable when available, otherwise use the location specified in pelias.json
const WOF_DIR = process.env.WOF_DIR || path.join(config.datapath, 'sqlite');

const dbFiles = fs.readdirSync(WOF_DIR)
  .filter(file => SQLITE_REGEX.test(file))
  .map(file => path.join(WOF_DIR, file));

const layers = fs.readFileSync(path.join(__dirname, 'placetype.filter'), 'utf-8')
                  .replace(/^.*\(/, '') // Removes all characters before the first parenthesis
                  .match(/[a-z]+/g); // Get the layer list

console.error('building descendant population index...');
const descendantPopulationIndex = buildDescendantPopulationIndex(dbFiles, layers);
console.error(`descendant population index built, ${descendantPopulationIndex.size} records have a populous descendant`);

const jq_filter = new RegExp(
  fs.readFileSync(path.join(__dirname, 'jq.filter'), 'utf-8')
    .replace(/\n\s*/g, '') // Normalize multi-line
    .match(/test\(\s*"([^"]+(?:"\s*\+\s*"[^"]+)*)"\s*\)/)[1] // Extract pattern
    .replace(/"\s*\+\s*"/g, '') // Remove string concatenation
);

const output = () => {
  if (process.argv.length > 2 && process.argv[2] === 'build') {
    const ph = new Placeholder();
    ph.load({ reset: true });
    return through.obj((row, _, next) => {
      ph.insertWofRecord(row, next);
    }, done => {
      console.error('populate fts...');
      ph.populate();
      console.error('optimize...');
      ph.optimize();
      console.error('close...');
      ph.close();
      done();
    });
  } else {
    return through.obj((row, _, next) => {
      console.log(JSON.stringify(row));
      next();
    });
  }
};

async function* generateRecords() {
  for (const dbPath of dbFiles) {
    yield* new SQLiteStream(
      dbPath,
      config.importPlace ?
      SQLiteStream.findGeoJSONByPlacetypeAndWOFId(layers, config.importPlace) :
      SQLiteStream.findGeoJSONByPlacetype(layers)
    );
  }
}

const sqliteStream = Readable.from(generateRecords(), { objectMode: true });

sqliteStream
  .pipe(whosonfirst.toJSONStream())
  .pipe(through.obj((row, _, next) => {
    Object.keys(row.properties)
          .filter(key => !jq_filter.test(key))
          .forEach(key => delete row.properties[key]);
    next(null, row.properties);
  }))
  .pipe(through.obj((row, _, next) => {
    // attach the precomputed descendant population, if any, so wof.js's
    // isLikelyTransliterated check can use it without needing DB access
    const id = parseInt(row['wof:id'], 10);
    const maxDescendantPopulation = descendantPopulationIndex.get(id);
    if (maxDescendantPopulation !== undefined) {
      row[DESCENDANT_POPULATION_PROPERTY] = maxDescendantPopulation;
    }
    next(null, row);
  }))
  .pipe(output());
