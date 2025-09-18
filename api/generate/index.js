const fetch = require('node-fetch');
const querystring = require('querystring');

module.exports = async function (context, req) {
  const { prompt, height, width, apiType } = req.body;

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
    context.log("Missing client ID or secret");
    context.res = {
      status: 500,
      body: { error: "Missing Adobe credentials in environment variables." }
    };
    return;
  }

  try {
    context.log("🔐 Generating token...");

    // Adobe expects x-www-form-urlencoded body, not JSON
    const tokenBody = querystring.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "openid AdobeID session additional_info firefly_api ff_apis read_organizations read_avatars read_jobs"
    });

    const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenBody
    });

    const rawTokenResponse = await tokenRes.text();
    context.log("Raw Adobe token response:", rawTokenResponse);

    let tokenData;
    try {
      tokenData = JSON.parse(rawTokenResponse);
    } catch (e) {
      context.log("Failed to parse Adobe token JSON:", e.message);
      context.res = {
        status: 500,
        body: { error: "Adobe token response is invalid JSON" }
      };
      return;
    }

    const accessToken = tokenData.access_token;

    if (!accessToken) {
      context.log("Failed to get access token:", rawTokenResponse);
      context.res = {
        status: 500,
        body: { error: "Failed to get access token from Adobe" }
      };
      return;
    }

    context.log("✅ Token generated!");

    // Submit video generation job
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

    const rawJobResponse = await jobRes.text();
    context.log("Raw video job submission response:", rawJobResponse);

    let job;
    try {
      job = JSON.parse(rawJobResponse);
    } catch (e) {
      context.log("Failed to parse video job JSON:", e.message);
      context.res = {
        status: 500,
        body: { error: "Video job response is invalid JSON" }
      };
      return;
    }

    const statusUrl = job.statusUrl;

    if (!statusUrl) {
      context.log("Video job submission failed:", rawJobResponse);
      context.res = {
        status: 500,
        body: { error: "Video job submission failed" }
      };
      return;
    }

    context.log("🎬 Video job submitted. Polling for completion...");

    // Polling for completion
    let videoUrl = null;
    for (let i = 0; i < 18; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds

      const statusCheck = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId,
          'Accept': 'application/json'
        }
      });

      const rawStatusResponse = await statusCheck.text();
      context.log(`Raw status response [attempt ${i + 1}]:`, rawStatusResponse);

      let statusData;
      try {
        statusData = JSON.parse(rawStatusResponse);
      } catch (e) {
        context.log("Failed to parse status JSON:", e.message);
        continue; // skip this iteration and poll again
      }

      context.log(`Status attempt ${i + 1}:`, statusData.status);

      if (statusData.status === "succeeded" && statusData.output && statusData.output.uri) {
        videoUrl = statusData.output.uri;
        break;
      }
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
          message: "Video is still processing. Try again later.",
          statusUrl
        }
      };
    }

  } catch (err) {
    context.log("ERROR:", err.message);
    context.res = {
      status: 500,
      body: { error: err.message || "Internal Server Error" }
    };
  }
};
