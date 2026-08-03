var fs = require('fs');
var os = require('os');
var path = require('path');
var Database = require('better-sqlite3');
var buildDescendantPopulationIndex = require('../../lib/descendantPopulationIndex');

// minimal schema matching the tables descendantPopulationIndex.js queries:
// geojson(id, body, is_alt), spr(id, name, placetype, is_deprecated, is_superseded),
// ancestors(id, ancestor_id)
function createFixtureDb( records, ancestorPairs ){
  var dbPath = path.join( os.tmpdir(), 'placeholder-test-' + Math.random().toString(36).slice(2) + '.db' );
  var db = new Database( dbPath );

  db.exec(`
    CREATE TABLE geojson (id INTEGER, body TEXT, is_alt INTEGER);
    CREATE TABLE spr (id INTEGER, name TEXT, placetype TEXT, is_deprecated INTEGER, is_superseded INTEGER);
    CREATE TABLE ancestors (id INTEGER, ancestor_id INTEGER);
  `);

  var insertGeojson = db.prepare('INSERT INTO geojson (id, body, is_alt) VALUES (?, ?, 0)');
  var insertSpr = db.prepare('INSERT INTO spr (id, name, placetype, is_deprecated, is_superseded) VALUES (?, ?, ?, 0, 0)');
  var insertAncestor = db.prepare('INSERT INTO ancestors (id, ancestor_id) VALUES (?, ?)');

  records.forEach( r => {
    insertGeojson.run( r.id, JSON.stringify({ properties: r.properties }) );
    insertSpr.run( r.id, r.properties['wof:name'], r.properties['wof:placetype'] );
  });

  ancestorPairs.forEach( ([id, ancestorId]) => {
    insertAncestor.run( id, ancestorId );
  });

  db.close();
  return dbPath;
}

module.exports.build = function(test) {

  test( 'macrocounty with no population inherits max population from a descendant', function(t) {
    var dbPath = createFixtureDb([
      { id: 1, properties: { 'wof:id': 1, 'wof:name': 'Example County', 'wof:placetype': 'macrocounty' } },
      { id: 2, properties: { 'wof:id': 2, 'wof:name': 'Small Town', 'wof:placetype': 'locality', 'wof:population': 500 } },
      { id: 3, properties: { 'wof:id': 3, 'wof:name': 'Big Town', 'wof:placetype': 'locality', 'wof:population': 50000 } }
    ], [
      [ 2, 1 ], // Small Town is a descendant of Example County
      [ 3, 1 ]  // Big Town is a descendant of Example County
    ]);

    var index = buildDescendantPopulationIndex( [ dbPath ], [ 'macrocounty', 'locality' ] );
    t.equal( index.get(1), 50000, 'macrocounty inherits the highest descendant population' );
    t.notOk( index.has(2), 'a record is not its own descendant' );
    t.notOk( index.has(3), 'a leaf record with no descendants has no entry' );

    fs.unlinkSync( dbPath );
    t.end();
  });

  test( 'ignores population from placetypes outside the requested layers', function(t) {
    var dbPath = createFixtureDb([
      { id: 1, properties: { 'wof:id': 1, 'wof:name': 'Example County', 'wof:placetype': 'macrocounty' } },
      { id: 2, properties: { 'wof:id': 2, 'wof:name': 'Excluded', 'wof:placetype': 'venue', 'wof:population': 999999 } }
    ], [
      [ 2, 1 ]
    ]);

    var index = buildDescendantPopulationIndex( [ dbPath ], [ 'macrocounty' ] );
    t.notOk( index.has(1), 'population from an out-of-scope placetype is not counted' );

    fs.unlinkSync( dbPath );
    t.end();
  });

  test( 'merges results across multiple db files', function(t) {
    var dbPathA = createFixtureDb([
      { id: 1, properties: { 'wof:id': 1, 'wof:name': 'Example County', 'wof:placetype': 'macrocounty' } }
    ], []);
    var dbPathB = createFixtureDb([
      { id: 2, properties: { 'wof:id': 2, 'wof:name': 'Big Town', 'wof:placetype': 'locality', 'wof:population': 12345 } }
    ], [
      [ 2, 1 ]
    ]);

    var index = buildDescendantPopulationIndex( [ dbPathA, dbPathB ], [ 'macrocounty', 'locality' ] );
    t.equal( index.get(1), 12345, 'ancestor/descendant relationships are resolved across db files' );

    fs.unlinkSync( dbPathA );
    fs.unlinkSync( dbPathB );
    t.end();
  });

};
