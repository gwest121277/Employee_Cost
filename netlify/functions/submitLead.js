// netlify/functions/submitLead.js
const fetch = require('node-fetch'); // Need to require node-fetch for Netlify functions

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Only POST requests are allowed' })
        };
    }

    try {
        const incomingData = JSON.parse(event.body);
        console.log('Data received by Netlify function:', incomingData);

        // The URL you copied from Google Apps Script deployment
        const GOOGLE_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzbh7cFQMktiEiWDX4_bGBidhusBEeKnEVZs6oOxvNCcrWtAHj6jFFNBKuTJW7_74qr8w/exec";

        const responseFromGoogleScript = await fetch(GOOGLE_SCRIPT_WEB_APP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(incomingData) // Forward the same data structure
        });

        if (!responseFromGoogleScript.ok) {
            // If Google Script returned an error, log it and pass it along
            const errorBody = await responseFromGoogleScript.text(); // Or .json() if it returns JSON error
            console.error('Error from Google Script:', errorBody);
            return {
                statusCode: responseFromGoogleScript.status,
                body: JSON.stringify({ message: 'Error sending data to Google Sheet', error: errorBody })
            };
        }

        const responseDataFromGoogleScript = await responseFromGoogleScript.json();
        console.log('Response from Google Script:', responseDataFromGoogleScript);

        // Return a success response to the frontend
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Data successfully sent to Google Sheet!',
                googleResponse: responseDataFromGoogleScript, // Include Google's response
                receivedData: incomingData // You can still include the original data if helpful
            })
        };

    } catch (error) {
        console.error('Error processing request in Netlify function:', error);
        return {
            statusCode: 500, // Internal Server Error
            body: JSON.stringify({ message: 'Error processing your request in Netlify function', error: error.message })
        };
    }
};