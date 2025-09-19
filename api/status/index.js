let latestStatus = "Not started"; // Shared variable (in-memory; resets on cold start)

module.exports = async function (context, req) {
  context.res = {
    status: 200,
    body: { status: latestStatus }
  };
};

// Export status updater for other functions to modify
module.exports.setStatus = (message) => {
  latestStatus = message;
};
