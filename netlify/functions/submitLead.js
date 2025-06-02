// netlify/functions/submitLead.js
const fetch = require('node-fetch'); // Using node-fetch v2
const MarkdownIt = require('markdown-it'); // For converting AI's Markdown to HTML

const md = new MarkdownIt({
    html: true, // Enable HTML tags in source
    linkify: true, // Autoconvert URL-like text to links
    typographer: true // Enable some smart quotes and other typographic enhancements
});

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
                    body: JSON.stringify(incomingData)
                });
                if (!responseFromGoogleScript.ok) {
                    const errorBody = await responseFromGoogleScript.text();
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
        let aiReportMarkdown = "AI report generation was not attempted or failed."; // Store as Markdown

        if (!OPENAI_API_KEY) {
            console.error('OpenAI API Key is not configured in environment variables.');
            aiReportMarkdown = "AI report could not be generated: OpenAI API Key is not configured.";
        } else if (!calculatorInputs) {
            console.error('Calculator input data is missing for OpenAI call.');
            aiReportMarkdown = "AI report could not be generated: calculator input data was missing.";
        } else {
            const systemMessage = `You are a professional financial advisor with deep expertise in employee turnover costs.
A business owner has just used an employee turnover cost calculator and will provide you with their input data.
Your task is to generate a visually appealing and professionally structured email report. The report should be direct, clear, concise, exceptionally helpful, and relevant to the job title provided.

The report must include these main sections, clearly delineated:
1.  Input Confirmation: Briefly restate the provided input data.
2.  Cost Analysis: Explain major cost contributors, highlighting hidden costs. Emphasize key figures by bolding them.
3.  Actionable Recommendations: Provide 3-5 distinct, practical strategies, prioritized (e.g., Quickest Impact, Most Cost-Effective, Greatest Long-Term ROI).
4.  Output Validation & Insight: Briefly validate the calculator’s result, emphasizing direct and indirect costs.

Formatting Instructions for a Visually Pleasing Email (using Markdown):
-   Main Sections: Use Level 2 Markdown headings (e.g., ## 1. Input Confirmation) for each main section.
-   Sub-Sections/Emphasis: Use Level 3 Markdown headings (e.g., ### Key Cost Factors) or bold text (**Key Point**) for emphasis within sections.
-   Lists: Utilize bullet points (- or *) for lists, such as recommendations or cost components.
-   Clarity and Readability: Ensure ample spacing between paragraphs and sections for easy reading. Use horizontal rules (---) to separate major sections if it enhances visual structure, but use them sparingly.
-   Professional Tone: Maintain a professional, practical, and empathetic tone.
-   Conciseness: Be direct and avoid fluff. The goal is a minimal yet impactful report.
-   Markdown for Email: Stick to standard Markdown elements widely supported in email clients.

Tone: Professional, practical, and empathetic. The user might be surprised by the costs; offer reassurance and clear guidance.
Length: Aim for around 400-600 tokens, ensuring all requested information and formatting are included without unnecessary verbosity.
CTA: Conclude with the call to action: "Need help applying these insights? Book a quick consult at https://calendly.com/gwest1212/30min to explore customized solutions." Ensure the CTA is clearly visible at the end.
Signature: The report must end immediately after the Call To Action. Do not add any generic placeholder signatures (e.g., "[Your Name]", "[Your Title]", "[Your Company]", "[Your Contact Information]").`; // <-- MODIFIED LINE HERE`;

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
                        model: 'gpt-4o-mini', // Using gpt-4o-mini
                        messages: [
                            { role: 'system', content: systemMessage },
                            { role: 'user', content: userMessage }
                        ],
                        max_tokens: 700 // Increased slightly for potentially more structured markdown
                    })
                });
                if (!openaiResponse.ok) {
                    const errorData = await openaiResponse.json().catch(() => openaiResponse.text());
                    console.error('Error from OpenAI API:', errorData);
                    aiReportMarkdown = `Error generating AI report: ${typeof errorData === 'string' ? errorData : (errorData.error ? errorData.error.message : 'Unknown OpenAI error')}`;
                } else {
                    const responseData = await openaiResponse.json();
                    if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message) {
                        aiReportMarkdown = responseData.choices[0].message.content.trim();
                        console.log('AI Generated Markdown Report:', aiReportMarkdown);
                    } else {
                        console.error('Unexpected response structure from OpenAI:', responseData);
                        aiReportMarkdown = 'AI generated a response, but it could not be read correctly.';
                    }
                }
            } catch (aiError) {
                console.error('Error calling OpenAI API:', aiError);
                aiReportMarkdown = `Error calling OpenAI API: ${aiError.message}`;
            }
        }

        // --- 3. Convert AI report Markdown to HTML and Send via Mailgun ---
        const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
        const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
        const YOUR_SENDING_EMAIL = `greg@${MAILGUN_DOMAIN}`;
        let mailgunResponseData = { status: 'not_attempted', message: 'Mailgun call not made or prerequisites not met.' };
        let htmlAiReport = ""; // Will hold the HTML version of the report

        if (aiReportMarkdown && !aiReportMarkdown.startsWith("AI report could not be generated") && !aiReportMarkdown.startsWith("Error generating AI report")) {
            try {
                htmlAiReport = md.render(aiReportMarkdown); // Convert Markdown to HTML
            } catch (renderError) {
                console.error("Error converting Markdown to HTML:", renderError);
                htmlAiReport = `<p>Error rendering report. Please see raw data below:</p><pre>${aiReportMarkdown.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`; // Fallback
            }
        } else {
            // Use the error/default message from aiReportMarkdown directly if it's an error message
            htmlAiReport = `<p>${aiReportMarkdown.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
        }


        if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
            console.error('Mailgun API Key or Domain is not configured in environment variables.');
        } else if (email && htmlAiReport) { // Check for email and the converted HTML report
            const mailgunUrl = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;
            const emailParams = new URLSearchParams();
            emailParams.append('from', `Employee Cost Calculator <${YOUR_SENDING_EMAIL}>`);
            emailParams.append('to', email);
            emailParams.append('subject', 'Your Employee Turnover Cost Report');
            
            // Construct a more visually appealing email structure
            const fullEmailHtml = `
                <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
                            .email-container { max-width: 680px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9; }
                            .header { text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eee; }
                            .header h1 { margin: 0; color: #2c3e50; }
                            .report-content { padding: 20px 0; }
                            .report-content h1, .report-content h2, .report-content h3 { color: #2c3e50; }
                            .report-content h1 { font-size: 1.8em; }
                            .report-content h2 { font-size: 1.5em; margin-top: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
                            .report-content h3 { font-size: 1.2em; margin-top: 1em; }
                            .report-content ul { padding-left: 20px; }
                            .report-content li { margin-bottom: 0.5em; }
                            .report-content strong { color: #1a2533; }
                            .cta-section { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
                            .footer { text-align: center; font-size: 0.9em; color: #777; margin-top: 30px; padding-top: 10px; border-top: 1px solid #eee; }
                        </style>
                    </head>
                    <body>
                        <div class="email-container">
                            <div class="header">
                                <h1>Employee Turnover Cost Report</h1>
                            </div>
                            <div class="report-content">
                                <p>Hi there,</p>
                                <p>Thank you for using the Employee Turnover Cost Calculator. Here is your personalized report:</p>
                                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                                ${htmlAiReport}
                                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                            </div>
                            <div class="footer">
                                <p>We hope this helps!</p>
                            </div>
                        </div>
                    </body>
                </html>
            `;
            emailParams.append('html', fullEmailHtml);
            // Optional: Add plain text version from original Markdown
            // emailParams.append('text', `Hi there,\n\nThank you for using the Employee Turnover Cost Calculator. Here is your personalized report:\n\n${aiReportMarkdown}\n\nWe hope this helps!`);
            
            try {
                const responseFromMailgun = await fetch(mailgunUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
                    },
                    body: emailParams
                });

                if (!responseFromMailgun.ok) {
                    const errorBodyText = await responseFromMailgun.text();
                    let errorBodyJson = null;
                    try { errorBodyJson = JSON.parse(errorBodyText); } catch (e) { /* Not JSON */ }
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
                message: 'Process complete. Email sending status reflected in mailgunResponse.',
                googleResponse: googleSheetResponseData,
                aiReportPreview: aiReportMarkdown ? aiReportMarkdown.substring(0, 150) + "..." : "No AI report generated.", // Preview from Markdown
                mailgunResponse: mailgunResponseData
            })
        };

    } catch (mainError) {
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
    }
};
