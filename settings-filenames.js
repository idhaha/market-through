const fs = require('node:fs');
const path = require('node:path');

function migrateSettingsNames(directory) {
    for (const name of fs.readdirSync(directory)) {
        let target;
        if (name === 'autosaved_user_settings.json') target = 'user_settings_autosaved.json';
        else if (/^(manualsaved_user_settings|autosaved_user_settings)_\d{8}_\d{6}_\d{3}\.json$/.test(name)) {
            target = name.replace('manualsaved_user_settings_', 'user_settings_manualsaved_').replace('autosaved_user_settings_', 'user_settings_autosaved_');
        } else continue;
        const source = path.join(directory, name), destination = path.join(directory, target);
        try {
            const stat = fs.lstatSync(source);
            if (!stat.isFile()) continue;
            // Never overwrite an existing settings snapshot or backup.
            // Same-directory hard link makes the new name atomic and preserves metadata.
            // A crash before unlink leaves two complete copies of the same snapshot.
            fs.linkSync(source, destination);
            fs.unlinkSync(source);
        } catch (error) {
            if (error.code !== 'EEXIST') console.error(`[Settings filename migration] ${name}: ${error.message}`);
        }
    }
    const current = path.join(directory, 'user_settings_autosaved.json');
    const legacy = path.join(directory, 'autosaved_user_settings.json');
    return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy;
}

module.exports = { migrateSettingsNames };
