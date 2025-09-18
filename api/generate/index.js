const fetch = require('node-fetch');

module.exports = async function (context, req) {
  context.log("🔥 Function triggered");

  const { prompt, height, width, apiType, accessToken: providedToken } = req.body || {};

  if (apiType !== "video") {
    context.res = {
      status: 400,
      body: { error: "Only 'video' API is implemented in backend for now." }
    };
    return;
  }

  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  let accessToken = providedToken;

  try {
    if (!accessToken) {
      if (!clientId || !clientSecret) {
        context.log("❌ Missing client ID or secret");
        context.res = {
          status: 500,
          body: { error: "Missing Adobe credentials in environment variables." }
        };
        return;
      }

      context.log("🔐 No token provided. Requesting Adobe token...");

      const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "openid AdobeID session additional_info firefly_api ff_apis read_organizations read_avatars read_jobs"
        })
      });

      const rawText = await tokenRes.text();
      context.log("📥 Raw token response:", rawText);

      let tokenData;
      try {
        tokenData = JSON.parse(rawText);
      } catch (e) {
        throw new Error("❌ Adobe returned non-JSON response: " + rawText);
      }

      if (!tokenData.access_token) {
        throw new Error("❌ Failed to get token: " + JSON.stringify(tokenData));
      }

      accessToken = tokenData.access_token;
      context.log("✅ Token obtained from Adobe");
    } else {
      context.log("✅ Using manually provided access token");
    }

    // 2. Submit video generation job
    const jobRes = await fetch('https://firefly-api.adobe.io/v3/videos/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': clientId || 'FAKE_API_KEY', // just to pass header; ignored if token works
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
    context.log("🎬 Job response:", job);

    const statusUrl = job.statusUrl;

    if (!statusUrl) {
      throw new Error("Video job submission failed: " + JSON.stringify(job));
    }

    context.log("⏳ Video job submitted. Polling...");

    // 3. Poll for video completion
    let videoUrl = null;
    for (let i = 0; i < 18; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 sec wait
      const statusCheck = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId || 'FAKE_API_KEY',
          'Accept': 'application/json'
        }
      });

      const statusData = await statusCheck.json();
      context.log(`📦 Poll ${i + 1}:`, statusData.status);

      if (statusData.status === "succeeded" && statusData.output && statusData.output.uri) {
        videoUrl = statusData.output.uri;
        break;
      }
    }

    if (videoUrl) {
      context.res = {
        status: 200,
        body: {
          message: "✅ Video generated successfully!",
          videoUrl
        }
      };
    } else {
      context.res = {
        status: 202,
        body: {
          message: "Video is still processing. Try again later.",
          statusUrl
        }
      };
    }

  } catch (err) {
    context.log("🛑 ERROR:", err.message);
    context.res = {
      status: 500,
      body: { error: err.message || "Internal Server Error" }
    };
  }
};
