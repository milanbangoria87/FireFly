const fetch = require('node-fetch');

module.exports = async function (context, req) {
  context.log("🚀 Function started");

  try {
    const { prompt, height, width, apiType } = req.body || {};
    context.log("ℹ️ Request body:", req.body);

    if (apiType !== "video") {
      context.res = {
        status: 400,
        body: { error: "Only 'video' API is implemented in backend for now." }
      };
      return;
    }

    const clientId = process.env.FIREFLY_CLIENT_ID;
    const clientSecret = process.env.FIREFLY_SECRET;

    if (!clientId || !clientSecret) {
      context.log("❌ Missing Adobe credentials");
      context.res = {
        status: 500,
        body: { error: "Missing Adobe credentials in environment variables." }
      };
      return;
    }

    // 1. Get token
    context.log("🔐 Requesting Adobe access token...");

    const tokenResponse = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'openid AdobeID session additional_info firefly_api ff_apis read_organizations read_avatars read_jobs'
      })
    });

    const rawToken = await tokenResponse.text();
    context.log("📥 Raw token response:", rawToken);

    if (!tokenResponse.ok) {
      context.log("❗ Token fetch failed, status:", tokenResponse.status);
      context.res = {
        status: tokenResponse.status,
        body: { error: `Token fetch failed`, details: rawToken }
      };
      return;
    }

    let tokenData;
    try {
      tokenData = JSON.parse(rawToken);
    } catch (e) {
      context.log("❗ Could not parse token JSON:", e.message);
      context.res = {
        status: 500,
        body: { error: "Invalid JSON from token endpoint", details: rawToken }
      };
      return;
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      context.log("❗ Missing access_token field:", JSON.stringify(tokenData));
      context.res = {
        status: 500,
        body: { error: "Missing access_token in token response", details: tokenData }
      };
      return;
    }

    context.log("✅ Token acquired");

    // 2. Submit video generation job
    context.log("🎯 Submitting video generation request...");

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
        sizes: [{ height: parseInt(height), width: parseInt(width) }],
        videoSettings: {
          cameraMotion: "camera pan left",
          promptStyle: "anime",
          shotAngle: "aerial shot",
          shotSize: "close-up shot"
        }
      })
    });

    const rawGenerate = await generateRes.text();
    context.log("📥 Raw generate response:", rawGenerate);

    if (!generateRes.ok) {
      context.log("❗ Generate request failed, status:", generateRes.status);
      context.res = {
        status: generateRes.status,
        body: { error: "Video generation request failed", details: rawGenerate }
      };
      return;
    }

    let jobData;
    try {
      jobData = JSON.parse(rawGenerate);
    } catch (e) {
      context.log("❗ Could not parse job JSON:", e.message);
      context.res = {
        status: 500,
        body: { error: "Invalid JSON from job endpoint", details: rawGenerate }
      };
      return;
    }

    const statusUrl = jobData.statusUrl;
    if (!statusUrl) {
      context.log("❗ Missing statusUrl:", JSON.stringify(jobData));
      context.res = {
        status: 500,
        body: { error: "Missing statusUrl in job response", details: jobData }
      };
      return;
    }

    context.log("🔄 Polling status at:", statusUrl);

    // 3. Poll for status
    let videoUrl = null;
    for (let attempt = 0; attempt < 18; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      context.log(`⏳ Poll attempt ${attempt + 1}`);

      const statusRes = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId,
          'Accept': 'application/json'
        }
      });

      const rawStatus = await statusRes.text();
      context.log("📥 Raw status response:", rawStatus);

      if (!statusRes.ok) {
        context.log("⚠️ Status check failed with status:", statusRes.status);
        continue; // try again
      }

      let statusData;
      try {
        statusData = JSON.parse(rawStatus);
      } catch (e) {
        context.log("❗ Could not parse status JSON:", e.message);
        continue;
      }

      context.log("🔍 Status data:", statusData.status);

      if (statusData.status === "succeeded" && statusData.output && statusData.output.uri) {
        videoUrl = statusData.output.uri;
        break;
      }
    }

    if (videoUrl) {
      context.log("✅ Video ready:", videoUrl);
      context.res = {
        status: 200,
        body: {
          message: "Video generated successfully",
          videoUrl
        }
      };
    } else {
      context.log("⌛ Still processing or failed to get final URL");
      context.res = {
        status: 202,
        body: {
          message: "Video is still processing. Try again later",
          statusUrl
        }
      };
    }

  } catch (err) {
    context.log("🛑 Unexpected ERROR:", err.message);
    context.res = {
      status: 500,
      body: { error: err.message || "Unknown Error" }
    };
  }
};
