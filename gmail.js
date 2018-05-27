const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const redis = require("redis");
const CryptoJS = require("crypto-js");

// If modifying these scopes, delete credentials.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'enc.credentials.txt';
const SECRET_PATH = 'enc.client_secret.txt';
const REDIS_SET_NAME = 'dashboard';

var redisHost = process.env.WINBOX_REDIS_HOSTNAME;
if (!redisHost) {
    redisHost = 'localhost';
}

if (!process.env.WINBOX_GMAIL_PASSWORD) {
    console.log("WINBOX_GMAIL_PASSWORD isn't set! This must be set for the program to work! Exiting...");
    return;
}


// Load client secrets from a local file.
fs.readFile(SECRET_PATH, (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Google Sheets API.

    content = CryptoJS.AES.decrypt(content.toString(), process.env.WINBOX_GMAIL_PASSWORD).toString(CryptoJS.enc.Utf8);
    authorize(JSON.parse(content), listMessages);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        token = CryptoJS.AES.decrypt(token.toString(), process.env.WINBOX_GMAIL_PASSWORD).toString(CryptoJS.enc.Utf8);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return callback(err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

async function listMessages(auth) {
    const redisClient = redis.createClient({host: redisHost});
    const gmail = google.gmail({version: 'v1', auth});

    redisClient.on("error", function (err) {
        console.log("Redis Error: " + err);
    });
    try {
        const {data} = await gmail.users.messages.list({userId: "me"});
        if (data.messages.length <= 0) {
            return console.log("No messages at google");
        }


        for (let i = 0; i < data.messages.length; i++) {
            const m = data.messages[i];
            const {data: mContent} = await gmail.users.messages.get({
                userId: "me",
                id: m.id,
                format: "metadata"
            });
            await putIfNotExists(redisClient, mContent.id, JSON.stringify({
                source: "gmail",
                author: mContent.payload.headers.find(e => e.name === "From").value,
                title: mContent.payload.headers.find(e => e.name === "Subject").value,
                text: mContent.snippet,
                timestamp: mContent.internalDate
            }));
        }
    } catch (e) {
        console.log("Error: " + e);
    } finally {
        redisClient.quit();
    }
}

async function putIfNotExists(redisClient, key, value) {
    await new Promise((resolve, reject) => {
        redisClient.hget(REDIS_SET_NAME, key, (e, r) => {
            if (e || r) return resolve();

            console.log("New Mail found, pushing to redis HSETNX... key: " + key);
            redisClient.hsetnx(REDIS_SET_NAME, key, value);
            resolve();
        });
    });
}

