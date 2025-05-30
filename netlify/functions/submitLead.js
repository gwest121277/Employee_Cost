// netlify/functions/submitLead.js
exports.handler = async function(event, context) {
    // event.httpMethod will be 'POST' if we send a POST request
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Method Not Allowed
            body: JSON.stringify({ message: 'Only POST requests are allowed' })
        };
    }

    try {
        const data = JSON.parse(event.body);
        console.log('Data received by function:', data);

        // Here, we're just receiving the data and logging it for now.
        // Later, we'll add code to:
        // 1. Save to database
        // 2. Call AI service
        // 3. Send email

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Data received successfully!', receivedData: data })
        };
    } catch (error) {
        console.error('Error processing request:', error);
        return {
            statusCode: 400, // Bad Request (e.g., if JSON parsing fails)
            body: JSON.stringify({ message: 'Error processing your request', error: error.message })
        };
    }
};