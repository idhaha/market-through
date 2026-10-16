const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {migrateSettingsNames}=require('../../settings-filenames');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'settings-names-'));
const file=name=>path.join(dir,name);
try{
 const auto='autosaved_user_settings.json',manual='manualsaved_user_settings_20261016_010203_004.json',datedAuto='autosaved_user_settings_20261016_010203_004.json';
 for(const name of [auto,manual,datedAuto])fs.writeFileSync(file(name),JSON.stringify({original:name}));
 const modified=new Date('2026-10-15T12:00:00Z');fs.utimesSync(file(manual),modified,modified);
 fs.writeFileSync(file('user_settings.json'),'legacy');fs.writeFileSync(file('full_backup_20261010_010203_004.json'),'backup');
 const current=migrateSettingsNames(dir);assert.equal(current,file('user_settings_autosaved.json'));
 for(const [oldName,newName] of [[auto,'user_settings_autosaved.json'],[manual,'user_settings_manualsaved_20261016_010203_004.json'],[datedAuto,'user_settings_autosaved_20261016_010203_004.json']]){
  assert.equal(fs.existsSync(file(oldName)),false);assert.equal(JSON.parse(fs.readFileSync(file(newName))).original,oldName);
 }
 assert.equal(fs.statSync(file('user_settings_manualsaved_20261016_010203_004.json')).mtimeMs,modified.getTime());
 assert.equal(fs.readFileSync(file('user_settings.json'),'utf8'),'legacy');
 assert.equal(fs.readFileSync(file('full_backup_20261010_010203_004.json'),'utf8'),'backup');
 // If both names already exist, retain both without overwriting either.
 fs.writeFileSync(file(auto),'older settings');migrateSettingsNames(dir);
 assert.equal(fs.readFileSync(file(auto),'utf8'),'older settings');assert.equal(JSON.parse(fs.readFileSync(current)).original,auto);
 const collision='manualsaved_user_settings_20261017_010203_004.json';const destination='user_settings_manualsaved_20261017_010203_004.json';
 fs.writeFileSync(file(collision),'old backup');fs.writeFileSync(file(destination),'new backup');migrateSettingsNames(dir);
 assert.equal(fs.readFileSync(file(collision),'utf8'),'old backup');assert.equal(fs.readFileSync(file(destination),'utf8'),'new backup');
 console.log('PASS settings filename migration, data/mtime preservation, restart idempotence, collisions and legacy backups');
}finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(file(name));fs.rmdirSync(dir);}
