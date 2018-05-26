const fs = require('fs');
const readline = require('readline');
const CryptoJS = require("crypto-js");

encryptFile('client_secret.json', "pw");
encryptFile('credentials.json', "pw");

function encryptFile(file, password) {
    fs.readFile(file, (err, data) => {
        if (err) return console.log('Error loading file:', err);
        var cypher = CryptoJS.AES.encrypt(data.toString(), password);
        fs.writeFile("enc." + file, cypher.toString());
    });
}