const fetch = require('node-fetch');
const config = require('./config');

function lineNotify(message) {

    const url = "https://notify-api.line.me/api/notify";

    var headers = new fetch.Headers;
    headers.append("Authorization", `Bearer ${config.LINE_GROUP_TOKEN}`);
    headers.append("Content-Type", "application/x-www-form-urlencoded");

    var body = new URLSearchParams();

    const request_options = {
        method: 'POST',
        headers: headers,
        body: body
    };

    body.append("message", message);

    fetch(url, request_options)
    .then(() => {

    })
    .catch((err) => {
        console.log('Error sending LINE notification: ' + err.status);
    });

}

module.exports = {
    lineNotify
}