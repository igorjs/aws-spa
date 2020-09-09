import AdmZip from "adm-zip";
import { readFileSync } from "fs";
import md5File from "md5-file";
import { lambda } from "./aws-services";
import { getRoleARNForBasicLambdaExectution } from "./iam";
import { logger } from "./logger";

export const lambdaPrefix = `aws-spa-`;

export const deployLambdaEdge = async (
  domainName: string,
  path: string,
  codePath: string
) => {
  const zippedCode = getZipCode(codePath);

  return _deployLambdaEdge(
    domainName,
    path,
    await md5File(codePath),
    zippedCode
  );
};

export const _deployLambdaEdge = async (
  domainName: string,
  path: string,
  identifier: string,
  zippedCode: Buffer
) => {
  const name = `${lambdaPrefix}${(domainName + "-" + path)
    .replace(/[\.\/]/g, "-")
    .replace("*", "all")}`;

  const description = getDescription(identifier);

  if (!(await doesFunctionExists(name))) {
    const roleARN = await getRoleARNForBasicLambdaExectution(name);

    logger.info(`[Lambda] ✏️ Creating lambda function...`);
    await lambda
      .createFunction({
        Code: {
          ZipFile: zippedCode,
        },
        FunctionName: name,
        Handler: "lambda.handler",
        Role: roleARN,
        Runtime: "nodejs12.x",
        Description: description,
        Publish: true,
      })
      .promise();
    logger.info(`[Lambda] 👍 lambda created`);
  }

  logger.info(`[Lambda] 🔍 Checking if lambda code changed...`);
  const { FunctionArn, Description } = await lambda
    .getFunctionConfiguration({ FunctionName: name })
    .promise();

  const { Versions } = await lambda
    .listVersionsByFunction({ FunctionName: name })
    .promise();

  if (
    Description &&
    Description === description &&
    Versions &&
    Versions.length > 0
  ) {
    const version = Versions[Versions.length - 1].Version;
    logger.info(`[Lambda] 👍 Code didn't changed. Everything is fine.`);
    return `${FunctionArn}:${version === "$LATEST" ? "1" : version}`;
  }

  logger.info(`[Lambda] ✏️ Code changed. Updating...`);
  const { Version: newVersion } = await lambda
    .updateFunctionCode({
      FunctionName: name,
      ZipFile: zippedCode,
      Publish: true,
    })
    .promise();
  await lambda
    .updateFunctionConfiguration({
      FunctionName: name,
      Description: description,
    })
    .promise();

  logger.info(`[Lambda] 👍 Code updated`);
  return `${FunctionArn}:${newVersion}`;
};

const getZipCode = (codePath: string) => {
  const zip = new AdmZip();
  zip.addFile("lambda.js", Buffer.from(readFileSync(codePath)));
  return zip.toBuffer();
};

export const deploySimpleAuthLambda = async (
  domainName: string,
  credentials: string
) => {
  return _deployLambdaEdge(
    domainName,
    "/",
    credentials,
    getSimpleAuthZippedCode(credentials)
  );
};

const doesFunctionExists = async (functionName: string) => {
  try {
    logger.info(`[Lambda] 🔍 Searching lambda function "${functionName}"...`);

    await lambda
      .getFunction({
        FunctionName: functionName,
      })
      .promise();

    logger.info(`[Lambda] 👍 lambda function found`);
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      logger.info(`[Lambda] 😬 No lambda found`);
      return false;
    }
    throw error;
  }
};

export const getDescription = (identifier: string) =>
  `Deployed by aws-spa [identifier=${identifier}]`;

const getSimpleAuthZippedCode = (credentials: string) => {
  const zip = new AdmZip();
  zip.addFile("simple-auth.js", Buffer.from(getLambdaCode(credentials)));

  return zip.toBuffer();
};

// lambda@edge does not allow to use env variables :-/
const getLambdaCode = (credentials: string) => `
exports.handler = (event, context, callback) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;

  const authString =
    "Basic " + new Buffer("${credentials}").toString("base64");

  if (
    typeof headers.authorization == "undefined" ||
    headers.authorization[0].value != authString
  ) {
    const body = "Unauthorized";
    const response = {
      status: "401",
      statusDescription: "Unauthorized",
      body: body,
      headers: {
        "www-authenticate": [{ key: "WWW-Authenticate", value: "Basic" }]
      }
    };
    callback(null, response);
  }

  callback(null, request);
};
`;
