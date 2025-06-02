// netlify/functions/submitLead.js
const fetch = require('node-fetch'); // Using node-fetch v2

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Only POST requests are allowed' }) };
    }

    let incomingData;
    try {
        incomingData = JSON.parse(event.body);
        console.log('Data received by Netlify function:', incomingData);
    } catch (error) {
        console.error('Error parsing incoming JSON:', error);
        return { statusCode: 400, body: JSON.stringify({ message: 'Bad request: Error parsing JSON body' }) };
    }

    const { email, calculatorInputs } = incomingData;

    // --- 1. Send data to Google Sheet ---
    const GOOGLE_SCRIPT_WEB_APP_URL = process.env.GOOGLE_SCRIPT_WEB_APP_URL;
    let googleSheetResponseData = null;

    if (!GOOGLE_SCRIPT_WEB_APP_URL) {
        console.error('Google Apps Script URL is not configured in environment variables.');
    } else {
        try {
            const responseFromGoogleScript = await fetch(GOOGLE_SCRIPT_WEB_APP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(incomingData)
            });
            if (!responseFromGoogleScript.ok) {
                const errorBody = await responseFromGoogleScript.text();
                console.error('Error from Google Script:', errorBody);
            } else {
                googleSheetResponseData = await responseFromGoogleScript.json();
                console.log('Response from Google Script:', googleSheetResponseData);
            }
        } catch (googleError) {
            console.error('Error calling Google Script:', googleError);
        }
    }

    // --- 2. Call OpenAI API to generate the report ---
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    let aiReport = "AI report could not be generated due to a configuration issue or API error.";

    if (!OPENAI_API_KEY) {
        console.error('OpenAI API Key is not configured in environment variables.');
    } else {
        const systemMessage = `You are a professional financial advisor with deep expertise in employee turnover costs. 
A business owner has just used an employee turnover cost calculator and will provide you with their input data.
Using the provided data, generate a clear, concise, and helpful report for the business owner with four main parts:

Input Confirmation
Briefly restate the provided input data to build trust and ensure clarity.

Cost Analysis
Explain the major contributors to the turnover cost for this role. Highlight commonly overlooked hidden costs (e.g., lost productivity, training time, team disruption) to help the user understand where the true expenses come from.

Actionable Recommendations
Provide 3–5 distinct, practical strategies the business owner can implement to reduce turnover costs. Prioritize these by indicating which offer:
The quickest impact
The most cost-effective implementation
The greatest long-term ROI

Output Validation & Insight
Offer a short, credible explanation validating the calculator’s result. Emphasize that the total cost includes both direct and indirect costs, which are often underestimated.

Tone: Professional, practical, and empathetic. Assume the user may be surprised by the total cost and is seeking both reassurance and actionable guidance.
Length: Keep the response well-structured and concise, but allow enough depth to make each section informative (target: ~400–600 tokens total).
CTA: “Need help applying these insights? Book a quick consult at https://calendly.com/gwest1212/30min to explore customized solutions.”`;

        const userMessage = `Here is the employee turnover data:
Role: ${calculatorInputs.role}
Average Annual Salary: $${calculatorInputs.avgSalary.toLocaleString()}
Number of Exits (last 12 months): ${calculatorInputs.numExits}
Fixed Cost per New Hire: $${calculatorInputs.fixedCost.toLocaleString()}
Estimated Cost Percentage of Salary for Turnover: ${calculatorInputs.costPercent}%`;

        try {
            const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
               
body: JSON.stringify({
    model: 'gpt-4o-mini', // Changed from 'gpt-3.5-turbo'
    messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
    ], max_tokens: 600 // Increased slightly for potentially longer reports with CTA
                })
            });
            if (!openaiResponse.ok) {
                const errorData = await openaiResponse.json();
                console.error('Error from OpenAI API:', errorData);
                aiReport = `Error generating AI report: ${errorData.error ? errorData.error.message : 'Unknown OpenAI error'}`;
            } else {
                const responseData = await openaiResponse.json();
                if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message) {
                    aiReport = responseData.choices[0].message.content.trim();
                    console.log('AI Generated Report:', aiReport);
                } else {
                    console.error('Unexpected response structure from OpenAI:', responseData);