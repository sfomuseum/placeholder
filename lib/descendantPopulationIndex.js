
// Builds a `Map<wof:id, maxDescendantPopulation>` from the WOF sqlite `ancestors`
// table, so that admin polygons with no population of their own (eg. macrocounties)
// can be recognised as non-obscure when they contain a populous descendant.
//
// see: prototype/wof.js `isLikelyTransliterated`

const Database = require('better-sqlite3');
const wof = require('../prototype/wof');

/**
 * Pass 1: collect the population of every record among `dbFiles` whose
 * placetype is in `layers` (the same filter used for the main extraction).
 *
 * @param {string[]} dbFiles
 * @param {string[]} layers
 * @returns {Map<number, number>} id -> population
 */
function collectPopulations( dbFiles, layers ){
  const idToPopulation = new Map();

  dbFiles.forEach( dbPath => {
    const db = new Database( dbPath, { readonly: true } );
    const stmt = db.prepare(`
      SELECT geojson.id, geojson.body
      FROM geojson
      JOIN spr ON geojson.id = spr.id
      WHERE geojson.id != 1
        AND geojson.is_alt != 1
        AND spr.is_deprecated = 0
        AND spr.is_superseded = 0
        AND spr.placetype IN ('${layers.join('\',\'')}')
    `);

    for( const row of stmt.iterate() ){
      let properties;
      try {
        properties = JSON.parse( row.body ).properties;
      } catch( e ){
        continue;
      }
      const population = parseInt( wof.getPopulation( properties ), 10 );
      if( Number.isFinite( population ) && population > 0 ){
        idToPopulation.set( row.id, population );
      }
    }

    db.close();
  });

  return idToPopulation;
}

/**
 * Pass 2: roll each record's population up to every one of its WOF ancestors,
 * keeping the highest value seen per ancestor.
 *
 * @param {string[]} dbFiles
 * @param {Map<number, number>} idToPopulation
 * @returns {Map<number, number>} ancestor id -> max descendant population
 */
function rollUpToAncestors( dbFiles, idToPopulation ){
  const descendantPopulation = new Map();

  dbFiles.forEach( dbPath => {
    const db = new Database( dbPath, { readonly: true } );
    const stmt = db.prepare('SELECT id, ancestor_id FROM ancestors');

    for( const row of stmt.iterate() ){
      const population = idToPopulation.get( row.id );
      if( population === undefined ){ continue; }

      const existing = descendantPopulation.get( row.ancestor_id ) || 0;
      if( population > existing ){
        descendantPopulation.set( row.ancestor_id, population );
      }
    }

    db.close();
  });

  return descendantPopulation;
}

/**
 * @param {string[]} dbFiles - absolute paths to whosonfirst-data-*.db files
 * @param {string[]} layers - wof:placetype values to consider for population data
 * @returns {Map<number, number>} wof:id -> highest population found among its descendants
 */
module.exports = function buildDescendantPopulationIndex( dbFiles, layers ){
  const idToPopulation = collectPopulations( dbFiles, layers );
  return rollUpToAncestors( dbFiles, idToPopulation );
};
