exports.handler = (event, context, callback) => {
  const request = event.Records[0].cf.request;
  const response = {
    status: "200",
    statusDescription: "OK",
    body: JSON.stringify({
      country: request.headers["cloudfront-viewer-country"],
      countryName: request.headers["cloudfront-viewer-country-name"],
      region: request.headers["cloudfront-viewer-country-region"],
      regionName: request.headers["cloudfront-viewer-country-region-name"],
      city: request.headers["cloudfront-viewer-city"],
      postalCode: request.headers["cloudfront-viewer-postal-code"],
      timeZone: request.headers["cloudfront-viewer-time-zone"],
      latitude: request.headers["cloudfront-viewer-latitude"],
      longitude: request.headers["cloudfront-viewer-longitude"],
      metroCode: request.headers["cloudfront-viewer-metro-code"],
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
