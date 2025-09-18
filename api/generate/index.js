// 🔧 API and model version mapping
const API_MAP = {
  image: {
    endpoint: "https://firefly-api.adobe.io/v2/images/generate",
    model: "image2_standard"
  },
  video: {
    endpoint: "https://firefly-api.adobe.io/v3/videos/generate",
    model: "video1_standard"
  },
  avatar: {
    endpoint: "https://firefly-api.adobe.io/v1/avatars/generate",
    model: "avatar1_standard"
  },
  audio: {
    endpoint: "https://firefly-api.adobe.io/v1/audio/generate",
    model: "audio1_standard"
  }
};
