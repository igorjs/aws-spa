import {
  DistributionConfig,
  DistributionSummary,
  Tag,
} from "aws-sdk/clients/cloudfront";
import { getAll } from "./aws-helper";
import { bucketRegion, cloudfront, websiteEndpoint } from "./aws-services";
import { logger } from "./logger";

export interface DistributionIdentificationDetail {
  Id: string;
  ARN: string;
  DomainName: string;
}

export const findDeployedCloudfrontDistribution = async (
  domainName: string
) => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[CloudFront] 🔍 searching cloudfront distribution (page ${page})...`
      );

      const { DistributionList } = await cloudfront
        .listDistributions({
          Marker: nextMarker,
        })
        .promise();

      if (!DistributionList) {
        return { items: [], nextMarker: undefined };
      }

      return {
        items: DistributionList.Items || [],
        nextMarker: DistributionList.NextMarker,
      };
    }
  );

  const distribution = distributions.find((_distribution) =>
    Boolean(
      _distribution.Aliases.Items &&
        _distribution.Aliases.Items.includes(domainName)
    )
  );

  if (!distribution) {
    logger.info(`[CloudFront] 😬 No matching distribution`);
    return null;
  }

  const { Tags } = await cloudfront
    .listTagsForResource({ Resource: distribution.ARN })
    .promise();
  if (
    !Tags ||
    !Tags.Items ||
    !Tags.Items.find(
      (tag) =>
        tag.Key === identifyingTag.Key && tag.Value === identifyingTag.Value
    )
  ) {
    throw new Error(
      `CloudFront distribution ${distribution.Id} has no tag ${identifyingTag.Key}:${identifyingTag.Value}`
    );
  }

  logger.info(`[CloudFront] 👍 Distribution found: ${distribution.Id}`);

  if (["InProgress", "In Progress"].includes(distribution.Status)) {
    logger.info(
      `[CloudFront] ⏱ Waiting for distribution to be deployed. This step might takes up to 25 minutes...`
    );
    await cloudfront
      .waitFor("distributionDeployed", { Id: distribution.Id })
      .promise();
  }
  return distribution;
};

export const tagCloudFrontDistribution = async (
  distribution: DistributionIdentificationDetail
) => {
  logger.info(
    `[CloudFront] ✏️ Tagging "${distribution.Id}" bucket with "${identifyingTag.Key}:${identifyingTag.Value}"...`
  );
  await cloudfront
    .tagResource({
      Resource: distribution.ARN,
      Tags: {
        Items: [identifyingTag],
      },
    })
    .promise();
};

export const createCloudFrontDistribution = async (
  domainName: string,
  sslCertificateARN: string
): Promise<DistributionIdentificationDetail> => {
  logger.info(
    `[CloudFront] ✏️ Creating Cloudfront distribution with origin "${getS3DomainName(
      domainName
    )}"...`
  );

  const { Distribution } = await cloudfront
    .createDistribution({
      DistributionConfig: getDistributionConfig(domainName, sslCertificateARN),
    })
    .promise();

  if (!Distribution) {
    throw new Error("[CloudFront] Could not create distribution");
  }

  await tagCloudFrontDistribution(Distribution);

  logger.info(
    `[CloudFront] ⏱ Waiting for distribution to be available. This step might takes up to 25 minutes...`
  );
  await cloudfront
    .waitFor("distributionDeployed", { Id: Distribution.Id })
    .promise();
  return Distribution;
};

const getDistributionConfig = (
  domainName: string,
  sslCertificateARN: string
): DistributionConfig => ({
  CallerReference: Date.now().toString(),
  Aliases: {
    Quantity: 1,
    Items: [domainName],
  },
  Origins: {
    Quantity: 1,
    Items: [
      {
        Id: getOriginId(domainName),
        DomainName: getS3DomainName(domainName),
        CustomOriginConfig: {
          HTTPPort: 80,
          HTTPSPort: 443,
          OriginProtocolPolicy: "http-only",
          OriginSslProtocols: {
            Quantity: 1,
            Items: ["TLSv1"],
          },
          OriginReadTimeout: 30,
          OriginKeepaliveTimeout: 5,
        },
        CustomHeaders: {
          Quantity: 0,
          Items: [],
        },
        OriginPath: "",
      },
    ],
  },
  Enabled: true,
  Comment: "",
  PriceClass: "PriceClass_All",
  Logging: {
    Enabled: false,
    IncludeCookies: false,
    Bucket: "",
    Prefix: "",
  },
  CacheBehaviors: {
    Quantity: 0,
  },
  CustomErrorResponses: {
    Quantity: 0,
  },
  Restrictions: {
    GeoRestriction: {
      RestrictionType: "none",
      Quantity: 0,
    },
  },
  DefaultRootObject: "index.html",
  WebACLId: "",
  HttpVersion: "http2",
  DefaultCacheBehavior: getEmptyBehavior(domainName),
  ViewerCertificate: {
    ACMCertificateArn: sslCertificateARN,
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.1_2016",
    CertificateSource: "acm",
  },
});

const getS3DomainName = (domainName: string) =>
  `${domainName}.${websiteEndpoint[bucketRegion]}`;

const getOriginId = (domainName: string) =>
  `S3-Website-${getS3DomainName(domainName)}`;

export const invalidateCloudfrontCache = async (
  distributionId: string,
  paths: string,
  wait: boolean = false
) => {
  logger.info("[CloudFront] ✏️ Creating invalidation...");
  const { Invalidation } = await cloudfront
    .createInvalidation({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: paths.split(",").length,
          Items: paths.split(",").map((path) => path.trim()),
        },
      },
    })
    .promise();

  if (!Invalidation) {
    return;
  }

  if (wait) {
    logger.info(
      "[CloudFront] ⏱ Waiting for invalidation to be completed (can take up to 10 minutes)..."
    );
    await cloudfront
      .waitFor("invalidationCompleted", {
        DistributionId: distributionId,
        Id: Invalidation.Id,
      })
      .promise();
  }
};

export const identifyingTag: Tag = {
  Key: "managed-by-aws-spa",
  Value: "v1",
};

export const setLambdaEdgeBehavior = async (
  domainName: string,
  distributionId: string,
  lambdaFunctionARN: string,
  path: string
) => {
  const { DistributionConfig, ETag } = await cloudfront
    .getDistributionConfig({ Id: distributionId })
    .promise();

  logger.info(`[CloudFront] 📚 Checking if lambda edge is already setup...`);

  const newLambdaConfig = {
    LambdaFunctionARN: lambdaFunctionARN,
    EventType: "viewer-request",
    IncludeBody: false,
  };

  if (path === "*") {
    const lambdaConfigs = DistributionConfig!.DefaultCacheBehavior!
      .LambdaFunctionAssociations!.Items!;

    if (
      lambdaConfigs.find(
        (config) => config.LambdaFunctionARN === lambdaFunctionARN
      )
    ) {
      logger.info(`[CloudFront] 👍 Lambda edge already setup`);
      return;
    }

    const updatedLambdaConfigs = [
      ...lambdaConfigs.filter(
        (config) => config.EventType !== "viewer-request"
      ),
      newLambdaConfig,
    ];

    const updatedConfig = {
      ...DistributionConfig!,
      DefaultCacheBehavior: DistributionConfig!.DefaultCacheBehavior && {
        ...DistributionConfig!.DefaultCacheBehavior,
        LambdaFunctionAssociations: lambdaConfigs && {
          Quantity: updatedLambdaConfigs.length,
          Items: updatedLambdaConfigs,
        },
      },
    };

    logger.info(
      `[CloudFront] ✏️ Adding lambda edge to default behavior (and replacing "viewer-request" lambda if any)...`
    );
    await updateDistribution(distributionId, updatedConfig, ETag);
    return;
  }

  const lambdaARNWithoutVersion = lambdaFunctionARN.substr(
    0,
    lambdaFunctionARN.lastIndexOf(":")
  );

  const lambdaBehavior = DistributionConfig!.CacheBehaviors!.Items!.find(
    (behavior) =>
      behavior.LambdaFunctionAssociations!.Items!.find(
        (config) =>
          config.LambdaFunctionARN.substr(
            0,
            config.LambdaFunctionARN.lastIndexOf(":")
          ) === lambdaARNWithoutVersion
      )
  );

  if (lambdaBehavior) {
    if (
      lambdaBehavior.LambdaFunctionAssociations!.Items!.find(
        (config) => config.LambdaFunctionARN === lambdaFunctionARN
      )
    ) {
      logger.info(`[CloudFront] 👍 Lambda edge already setup`);
      return;
    }

    const updatedLambdaConfigs = [
      ...lambdaBehavior.LambdaFunctionAssociations!.Items!.filter(
        (config) => config.EventType !== "viewer-request"
      ),
      newLambdaConfig,
    ];

    const updatedConfig: DistributionConfig = {
      ...DistributionConfig!,
      CacheBehaviors: {
        ...DistributionConfig!.CacheBehaviors!,
        Items: [
          ...DistributionConfig!.CacheBehaviors!.Items!.filter(
            (behavior) => behavior.PathPattern !== lambdaBehavior.PathPattern
          ),
          {
            ...lambdaBehavior,
            LambdaFunctionAssociations: {
              Quantity: updatedLambdaConfigs.length,
              Items: updatedLambdaConfigs,
            },
          },
        ],
      },
    };

    logger.info(
      `[CloudFront] ✏️ Updating existing behavior for lambda edge...`
    );
    await updateDistribution(distributionId, updatedConfig, ETag);
    return;
  }

  const emptyBehavior = getEmptyBehavior(domainName);
  const newBehavior = {
    ...emptyBehavior,
    PathPattern: path,
    LambdaFunctionAssociations: { Quantity: 1, Items: [newLambdaConfig] },
  };

  const updatedConfig = {
    ...DistributionConfig!,
    CacheBehaviors: {
      Quantity: DistributionConfig!.CacheBehaviors!.Quantity + 1,
      Items: [...DistributionConfig!.CacheBehaviors!.Items!, newBehavior],
    },
  };

  logger.info(
    `[CloudFront] ✏️ Creating behavior for lambda edge (and replacing "viewer-request" lambda if any)...`
  );
  await updateDistribution(distributionId, updatedConfig, ETag);
  return;
};

export const getCacheInvalidations = (
  cacheInvalidations: string,
  subFolder: string | undefined
) =>
  cacheInvalidations
    .split(",")
    .map((string) => string.trim().replace(/^\//, ""))
    .map((string) => (subFolder ? `/${subFolder}/${string}` : `/${string}`))
    .join(",");

const updateDistribution = async (
  distributionId: string,
  DistributionConfig: DistributionConfig,
  ETag: string | undefined
) => {
  await cloudfront
    .updateDistribution({
      Id: distributionId,
      IfMatch: ETag,
      DistributionConfig,
    })
    .promise();
};

// const removeLambdaEdge = async (
//   distributionId: string,
//   distributionConfig: DistributionConfig,
//   eTag: string
// ) => {
//   logger.info(
//     `[CloudFront] 📚 No lambda edge configured. Checking if there is a lambda to remove...`
//   );

//   const defaultBehaviorLambdaFunctionAssociations = distributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations?.Items?.filter(
//     (config) => !config.LambdaFunctionARN.includes(lambdaPrefix)
//   );

//   const cacheBehaviors = distributionConfig.CacheBehaviors?.Items?.filter(
//     (behavior) =>
//       !behavior.LambdaFunctionAssociations?.Items?.find((config) =>
//         config.LambdaFunctionARN.includes(lambdaPrefix)
//       )
//   );

//   const updatedConfig: DistributionConfig = {
//     ...distributionConfig,
//     DefaultCacheBehavior: {
//       ...distributionConfig.DefaultCacheBehavior,
//       LambdaFunctionAssociations: defaultBehaviorLambdaFunctionAssociations && {
//         Quantity: defaultBehaviorLambdaFunctionAssociations.length,
//         Items: defaultBehaviorLambdaFunctionAssociations,
//       },
//     },
//     CacheBehaviors: cacheBehaviors && {
//       Quantity: cacheBehaviors.length,
//       Items: cacheBehaviors,
//     },
//   };

//   if (
//     cacheBehaviors?.length !== distributionConfig.CacheBehaviors?.Quantity ||
//     defaultBehaviorLambdaFunctionAssociations?.length !==
//       distributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations
//         ?.Quantity
//   ) {
//     logger.info(`[CloudFront] 🗑 Removing lambda function association...`);

//     await updateDistribution(distributionId, updatedConfig!, eTag);
//     logger.info(`[CloudFront] 👍 Lambda function association removed`);
//   } else {
//     logger.info(`[CloudFront] 👍 No lambda`);
//   }
//   return;
// };

const getEmptyBehavior = (domainName: string) => ({
  ViewerProtocolPolicy: "redirect-to-https",
  TargetOriginId: getOriginId(domainName),
  ForwardedValues: {
    QueryString: false,
    Cookies: {
      Forward: "none",
    },
    Headers: {
      Quantity: 0,
      Items: [],
    },
    QueryStringCacheKeys: {
      Quantity: 0,
      Items: [],
    },
  },
  AllowedMethods: {
    Quantity: 2,
    Items: ["HEAD", "GET"],
    CachedMethods: {
      Quantity: 2,
      Items: ["HEAD", "GET"],
    },
  },
  TrustedSigners: {
    Enabled: false,
    Quantity: 0,
  },
  MinTTL: 0,
  DefaultTTL: 86400,
  MaxTTL: 31536000,
  FieldLevelEncryptionId: "",
  LambdaFunctionAssociations: {
    Quantity: 0,
    Items: [],
  },
  SmoothStreaming: false,
  Compress: true,
});
