exports.handler = (event, context, callback) => {
  const request = event.Records[0].cf.request;
  const response = {
    status: "200",
    statusDescription: "OK",
    body: JSON.stringify({
      country: request.headers["cloudfront-viewer-country"][0]["value"],
      latitude: Number(
        request.headers["cloudfront-viewer-latitude"][0]["value"]
      ),
      longitude: Number(
        request.headers["cloudfront-viewer-longitude"][0]["value"]
      ),
    }),
    headers: {
      "content-type": [
        {
          key: "Content-Type",
          value: "application/json",
        },
      ],
      "content-encoding": [
        {
          key: "Content-Encoding",
          value: "UTF-8",
        },
      ],
    },
  };
  return callback(null, response);
};
