const fetch = require('node-fetch');

module.exports = async function (context, req) {
  const { statusUrl, apiType } = req.body;

  if (!statusUrl || !apiType) {
    context.res = { status: 400, body: { error: "Missing statusUrl or apiType." } };
    return;
  }

  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  // Get Adobe token (or cache it if you want to optimize)
  const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "session"
    })
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    context.res = { status: 500, body: { error: "Failed to obtain access token", details: tokenData } };
    return;
  }

  // Call statusUrl
  const statusRes = await fetch(statusUrl, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "x-api-key": clientId
    }
  });
  const statusData = await statusRes.json();

  // Extract output URL based on apiType
  let outputUrl;
  switch(apiType) {
    case 'video':
      outputUrl = statusData.result?.outputs?.[0]?.video?.url;
      break;
    case 'image':
      outputUrl = statusData.result?.outputs?.[0]?.image?.url;
      break;
    case 'audio':
      outputUrl = statusData.result?.outputs?.[0]?.audio?.url;
      break;
    case 'avatar':
      outputUrl = statusData.result?.outputs?.[0]?.avatar?.url;
      break;
  }

  context.res = {
    status: 200,
    body: {
      status: statusData.status,
      outputUrl
    }
  };
};
