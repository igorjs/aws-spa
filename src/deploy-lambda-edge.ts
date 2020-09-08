import { existsSync } from "fs";
import {
  DistributionIdentificationDetail,
  findDeployedCloudfrontDistribution,
} from "./cloudfront";
import { logger } from "./logger";

export const deployLambdaEdge = async (url: string, codePath: string) => {
  const [domainName, path] = url.split("/");

  logger.info(
    `✨ Deploying "${codePath}" lambda edge on "${domainName}" with path "${
      path || "/"
    }"...`
  );

  if (!existsSync(codePath)) {
    throw new Error(`File "${codePath}" not found`);
  }

  let distribution: DistributionIdentificationDetail | null = await findDeployedCloudfrontDistribution(
    domainName
  );
  if (!distribution) {
    throw new Error(
      `No distribution associated to domain ${domainName}: please run "aws-spa deploy" first`
    );
  }

  // if (credentials) {
  //   const simpleAuthLambdaARN = await deploySimpleAuthLambda(
  //     domainName,
  //     credentials
  //   );
  //   await setSimpleAuthBehavior(distribution.Id, simpleAuthLambdaARN);
  // } else {
  //   await setSimpleAuthBehavior(distribution.Id, null);
  // }
};
