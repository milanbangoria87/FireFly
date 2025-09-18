const fetch = require('node-fetch');

module.exports = async function (context, req) {
  const { prompt, height, width, apiType } = req.body;

  if (apiType !== "video") {
    context.res = {
      status: 400,
      body: { error: "Only 'video' API is implemented in backend for now." }
    };
    return;
  }

  // 1. Get Adobe credentials from environment
  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  if (!clientId || !clientSecret) {
    context.res = {
      status: 500,
      body: { error: "Missing Adobe credentials in environment variables." }
    };
    return;
  }

  try {
    // 2. Get access token from Adobe
    context.log("Fetching Adobe token...");
    const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("Token fetch failed: " + JSON.stringify(tokenData));
    }

    context.log("Token generated!");

    // 3. Prepare request to /videos/generate
    const generateRes = await fetch('https://firefly-api.adobe.io/v3/videos/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': clientId,
        'Content-Type': 'application/json',
        'x-model-version': 'video1_standard',
        'Accept': '*/*'
      },
      body: JSON.stringify({
        bitRateFactor: 18,
        image: { conditions: [] },
        prompt,
        seeds: [Math.floor(Math.random() * 1000000000)],
        sizes: [{ height, width }],
        videoSettings: {
          cameraMotion: "camera pan left",
          promptStyle: "anime",
          shotAngle: "aerial shot",
          shotSize: "close-up shot"
        }
      })
    });

    const job = await generateRes.json();
    const statusUrl = job.statusUrl;

    if (!statusUrl) {
      throw new Error("Job submission failed: " + JSON.stringify(job));
    }

    context.log("Video job submitted. Polling...");

    // 4. Poll status endpoint until ready (max 90s)
    let attempts = 0;
    let videoUrl = null;

    while (attempts < 18) { // ~90 seconds (18 x 5s)
      await new Promise(resolve => setTimeout(resolve, 5000));
      const statusCheck = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId,
          'Accept': 'application/json'
        }
      });

      const statusData = await statusCheck.json();
      context.log(`Status Check ${attempts + 1}:`, statusData.status);

      if (statusData.status === "succeeded" && statusData.output && statusData.output.uri) {
        videoUrl = statusData.output.uri;
        break;
      }

      attempts++;
    }

    if (videoUrl) {
      context.res = {
        status: 200,
        body: {
          message: "Video generated successfully!",
          videoUrl
        }
      };
    } else {
      context.res = {
        status: 202,
        body: {
          message: "Video still processing, try again later.",
          statusUrl
        }
      };
    }

else {
      context.res = {
        status: 500,
          headers: { 'Content-Type': 'application/json' },
  body: { error: err.message || "Unexpected server error" }
      };
    }
    
  } catch (err) {
    context.log("Error:", err);
    context.res = {
      status: 500,
      body: { error: err.message }
    };
  }
};
