import { existsSync } from "fs";
import {
  DistributionIdentificationDetail,
  findDeployedCloudfrontDistribution,
  setLambdaEdgeBehavior,
} from "./cloudfront";
import { deployLambdaEdge } from "./lambda";
import { logger } from "./logger";

export const attachLambdaEdge = async (url: string, codePath: string) => {
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

  const lambdaEdgeARN = await deployLambdaEdge(domainName, path, codePath);
  await setLambdaEdgeBehavior(domainName, distribution.Id, lambdaEdgeARN, path);
};
