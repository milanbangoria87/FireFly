const axios = require("axios");

module.exports = async function (context, req) {
  const prompt = req.body?.prompt;

  if (!prompt) {
    context.res = {
      status: 400,
      body: "Missing prompt"
    };
    return;
  }

  try {
    // 1. Get Adobe token using client credentials
    const tokenResponse = await axios.post("https://ims-na1.adobelogin.com/ims/token/v1", null, {
      params: {
        client_id: process.env.ADOBE_CLIENT_ID,
        client_secret: process.env.ADOBE_CLIENT_SECRET,
        grant_type: "client_credentials"
      },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const accessToken = tokenResponse.data.access_token;

    // 2. Call Firefly API with prompt
    const fireflyResponse = await axios.post(
      "https://firefly-api.adobe.io/v3/images/generate-async", // 🔁 Replace with actual endpoint
      { prompt },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    // 3. Return Firefly API response
    context.res = {
      status: 200,
      body: fireflyResponse.data
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: `Error: ${error.response?.data || error.message}`
    };
  }
};
