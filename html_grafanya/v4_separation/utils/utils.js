const fs = require('fs');

function readJSONFile(filePath, callback) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error(`Error reading file from disk: ${err}`);
            callback(err);
            return;
        }
        try {
            const jsonData = JSON.parse(data);
            callback(null, jsonData);
        } catch (err) {
            console.error(`Error parsing JSON string: ${err}`);
            callback(err);
        }
    });
}

module.exports = { readJSONFile };
