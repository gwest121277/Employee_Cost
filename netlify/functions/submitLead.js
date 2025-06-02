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
    } catch (parseError) {
        console.error('Error parsing incoming JSON:', parseError);
        return { statusCode: 400, body: JSON.stringify({ message: 'Bad request: Error parsing JSON body', details: parseError.message }) };
    }

    // Main try block for all subsequent operations
    try {
        const { email, calculatorInputs } = incomingData;

        // --- 1. Send data to Google Sheet ---
        const GOOGLE_SCRIPT_WEB_APP_URL = process.env.GOOGLE_SCRIPT_WEB_APP_URL;
        let googleSheetResponseData = { status: 'not_attempted', message: 'Google Script URL not configured or call not made.' };

        if (!GOOGLE_SCRIPT_WEB_APP_URL) {
            console.error('Google Apps Script URL is not configured in environment variables.');
        } else {
            try {
                const responseFromGoogleScript = await fetch(GOOGLE_SCRIPT_WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(incomingData) // Send the original incomingData which includes email and calculatorInputs
                });
                if (!responseFromGoogleScript.ok) {
                    const errorBody = await responseFromGoogleScript.text(); // .text() is safer if response isn't always JSON
                    console.error('Error from Google Script:', errorBody);
                    googleSheetResponseData = { status: 'error', message: 'Failed to send to Google Sheet', details: errorBody };
                } else {
                    googleSheetResponseData = await responseFromGoogleScript.json();
                    console.log('Response from Google Script:', googleSheetResponseData);
                }
            } catch (googleError) {
                console.error('Error calling Google Script:', googleError);
                googleSheetResponseData = { status: 'error', message: `Error calling Google Script: ${googleError.message}` };
            }
        }

        // --- 2. Call OpenAI API to generate the report ---
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        let aiReport = "AI report generation was not attempted or failed."; // Default/error message

        if (!OPENAI_API_KEY) {
            console.error('OpenAI API Key is not configured in environment variables.');
            aiReport = "AI report could not be generated: OpenAI API Key is not configured.";
        } else if (!calculatorInputs) {
            console.error('Calculator input data is missing for OpenAI call.');
            aiReport = "AI report could not be generated: calculator input data was missing.";
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
Role: ${calculatorInputs.role || 'Not provided'}
Average Annual Salary: $${calculatorInputs.avgSalary ? calculatorInputs.avgSalary.toLocaleString() : 'Not provided'}
Number of Exits (last 12 months): ${calculatorInputs.numExits !== null && calculatorInputs.numExits !== undefined ? calculatorInputs.numExits : 'Not provided'}
Fixed Cost per New Hire: $${calculatorInputs.fixedCost ? calculatorInputs.fixedCost.toLocaleString() : 'Not provided'}
Estimated Cost Percentage of Salary for Turnover: ${calculatorInputs.costPercent !== null && calculatorInputs.costPercent !== undefined ? calculatorInputs.costPercent : 'Not provided'}%`;

            try {
                const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini', // Using gpt-4o-mini as a good default
                        messages: [
                            { role: 'system', content: systemMessage },
                            { role: 'user', content: userMessage }
                        ],
                        max_tokens: 450 // Adjusted based on previous successful test for length
                    })
                });
                if (!openaiResponse.ok) {
                    const errorData = await openaiResponse.json().catch(() => openaiResponse.text()); 
                    console.error('Error from OpenAI API:', errorData);
                    aiReport = `Error generating AI report: ${typeof errorData === 'string' ? errorData : (errorData.error ? errorData.error.message : 'Unknown OpenAI error')}`;
                } else {
                    const responseData = await openaiResponse.json();
                    if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message) {
                        aiReport = responseData.choices[0].message.content.trim();
                        console.log('AI Generated Report:', aiReport);
                    } else {
                        console.error('Unexpected response structure from OpenAI:', responseData);
                        aiReport = 'AI generated a response, but it could not be read correctly.';
                    }
                }
            } catch (aiError) {
                console.error('Error calling OpenAI API:', aiError);
                aiReport = `Error calling OpenAI API: ${aiError.message}`;
            }
        }

        // --- 3. Send the AI report via Mailgun ---
        const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
        const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
        const YOUR_SENDING_EMAIL = `greg@${MAILGUN_DOMAIN}`; // e.g., greg@gregwest.net
        let mailgunResponseData = { status: 'not_attempted', message: 'Mailgun call not made or prerequisites not met.'};

        if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
            console.error('Mailgun API Key or Domain is not configured in environment variables.');
        } else if (email && aiReport && !aiReport.startsWith("AI report could not be generated") && !aiReport.startsWith("Error generating AI report")) {
            const htmlAiReport = aiReport.replace(/\n/g, '<br>');
            const mailgunUrl = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;
            const emailParams = new URLSearchParams(); // For x-www-form-urlencoded
            emailParams.append('from', `Employee Cost Calculator <${YOUR_SENDING_EMAIL}>`);
            emailParams.append('to', email);
            emailParams.append('subject', 'Your Employee Turnover Cost Report');
            emailParams.append('html', `<p>Hi there,</p><p>Thank you for using the Employee Turnover Cost Calculator. Here is your personalized report:</p><hr>${htmlAiReport}<hr><p>We hope this helps!</p>`);
            // You can also add a plain text version if desired:
            // emailParams.append('text', `Hi there,\n\nThank you for using the Employee Turnover Cost Calculator. Here is your personalized report:\n\n${aiReport}\n\nWe hope this helps!`);
            
            try {
                const responseFromMailgun = await fetch(mailgunUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
                        // 'Content-Type': 'application/x-www-form-urlencoded' // fetch sets this automatically for URLSearchParams
                    },
                    body: emailParams // Send as URLSearchParams
                });

                if (!responseFromMailgun.ok) {
                    // Mailgun often returns JSON for errors, but text for some other non-ok statuses
                    const errorBodyText = await responseFromMailgun.text();
                    let errorBodyJson = null;
                    try {
                        errorBodyJson = JSON.parse(errorBodyText);
                    } catch (e) {
                        // Not JSON, use the text
                    }
                    console.error('Error from Mailgun API:', errorBodyJson || errorBodyText);
                    mailgunResponseData = { status: 'error', message: 'Failed to send email', details: errorBodyJson || errorBodyText };
                } else {
                    mailgunResponseData = await responseFromMailgun.json();
                    console.log('Response from Mailgun API:', mailgunResponseData);
                }
            } catch (mailgunError) {
                console.error('Error calling Mailgun API:', mailgunError);
                mailgunResponseData = { status: 'error', message: `Error sending email: ${mailgunError.message}` };
            }
        } else if (!email) {
            console.log('No email provided by user; skipping Mailgun call.');
            mailgunResponseData = { status: 'skipped', message: 'No email provided.' };
        } else {
            console.log('AI report was not successfully generated or available; skipping Mailgun call.');
            mailgunResponseData = { status: 'skipped', message: 'AI report not available for sending.' };
        }

        // --- Return a consolidated response to the frontend ---
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Process complete. Check logs for details. Email sending status reflected in mailgunResponse.',
                googleResponse: googleSheetResponseData,
                aiReportPreview: aiReport ? aiReport.substring(0, 100) + "..." : "No AI report generated.", 
                mailgunResponse: mailgunResponseData
            })
        };

    } catch (mainError) { // This is the CATCH for the MAIN try block
        console.error('Outer critical error in Netlify function:', mainError);
        const emailForError = (typeof incomingData !== 'undefined' && incomingData && incomingData.email) ? incomingData.email : "No email captured";
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'General error processing your request.',
                error: mainError.message,
                user_email_for_reference: emailForError
            })
        };
    } // This '}' closes the main 'catch (mainError)'
}; // This '};' closes 'exports.handler'
