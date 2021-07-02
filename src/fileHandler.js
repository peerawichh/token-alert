const fs = require('fs');
const path = require('path');

async function writeFile(filePath, data) {
    return new Promise( (resolve, reject) => {
        fs.writeFile(filePath, data, (err) => {
            if (err) {
                reject('Write failed');
            } else {
                resolve('Write success');
            }
        });
    });
}

module.exports = {
    writeFile
}