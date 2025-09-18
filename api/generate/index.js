const fetch = require('node-fetch');

module.exports = async function (context, req) {
  context.log("🚀 Function started");

  try {
    const { prompt, height, width, apiType } = req.body || {};
    context.log("📝 Request Body:", req.body);

    if (apiType !== "video") {
      context.log("❌ Unsupported apiType:", apiType);
      context.res = {
        status: 400,
        body: { error: "Only 'video' API is implemented in backend for now." }
      };
      return;
    }

    const clientId = process.env.FIREFLY_CLIENT_ID;
    const clientSecret = process.env.FIREFLY_SECRET;

    if (!clientId || !clientSecret) {
      context.log("❌ Missing client ID or secret");
      context.res = {
        status: 500,
        body: { error: "Missing Adobe credentials in environment variables." }
      };
      return;
    }

    // 1. Get Adobe access token
    context.log("🔐 Generating token...");
    const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "session"
      })
    });

    const tokenData = await tokenRes.json();
    context.log("🎟️ Raw Adobe token response:", tokenData);

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("Failed to get access token: " + JSON.stringify(tokenData));
    }

    context.log("✅ Token acquired");

    // 2. Submit job
    context.log("🎬 Submitting video generation job...");
    const jobRes = await fetch('https://firefly-api.adobe.io/v3/videos/generate', {
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
        sizes: [{ height: parseInt(height), width: parseInt(width) }],
        videoSettings: {
          cameraMotion: "camera pan left",
          promptStyle: "anime",
          shotAngle: "aerial shot",
          shotSize: "close-up shot"
        }
      })
    });

    const job = await jobRes.json();
    context.log("📦 Job Response:", job);

    const statusUrl = job.statusUrl;
    if (!statusUrl) {
      throw new Error("Missing statusUrl from job response: " + JSON.stringify(job));
    }

    context.log("⏳ Polling status URL:", statusUrl);

    // 3. Polling for video generation
    let videoUrl = null;
    for (let i = 0; i < 18; i++) {
      context.log(`🔁 Poll attempt ${i + 1}`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5s

      const statusCheck = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId,
          'Accept': 'application/json'
        }
      });

      const statusData = await statusCheck.json();
      context.log(`📡 Status Check ${i + 1}:`, statusData);

      if (statusData.status === "succeeded" && statusData.output && statusData.output.uri) {
        videoUrl = statusData.output.uri;
        break;
      }
    }

    if (videoUrl) {
      context.log("✅ Video URL:", videoUrl);
      context.res = {
        status: 200,
        body: {
          message: "Video generated successfully!",
          videoUrl
        }
      };
    } else {
      context.log("⏳ Video still processing.");
      context.res = {
        status: 202,
        body: {
          message: "Video is still processing. Try again later.",
          statusUrl
        }
      };
    }

  } catch (err) {
    context.log("❗ERROR:", err.message);
    context.res = {
      status: 500,
      body: { error: err.message || "Internal Server Error" }
    };
  }
};
