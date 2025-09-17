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
    const response = await axios.post(
      "https://firefly.adobe.io/api/your-endpoint", // 🔁 Replace with actual Adobe endpoint
      { prompt },
      {
        headers: {
          Authorization: `Bearer ${process.env.ADOBE_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    context.res = {
      status: 200,
      body: response.data
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: `Error: ${error.message}`
    };
  }
};

