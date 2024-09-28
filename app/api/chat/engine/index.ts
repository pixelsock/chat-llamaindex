import { LlamaCloudIndex } from "llamaindex/cloud/LlamaCloudIndex";
import type { CloudConstructorParams } from "llamaindex/cloud/constants";

export type LlamaCloudDataSourceParams = {
  project?: string;
  pipeline?: string;
  ensureIndex?: boolean;
};

export function parseDataSource(
  datasource: string,
): LlamaCloudDataSourceParams {
  try {
    return JSON.parse(datasource) as LlamaCloudDataSourceParams;
  } catch (e) {
    console.warn(
      `Failed to parse datasource: ${e instanceof Error ? e.message : "Unknown error"}`,
    );
    return {};
  }
}

export async function getDataSource(params: LlamaCloudDataSourceParams) {
  console.log(`Getting data source with params: ${JSON.stringify(params)}`);
  try {
    checkEnvVars();
    if (params.ensureIndex) {
      console.log("Ensuring index exists...");
      try {
        await LlamaCloudIndex.fromDocuments({
          ...createParams(params),
          documents: [],
        });
        console.log("Index ensured successfully");
      } catch (e) {
        if ((e as any).status === 400) {
          console.log(
            "Received 400 error, ignoring as it's expected when calling fromDocuments with empty documents",
          );
        } else {
          console.error(
            `Error ensuring index: ${e instanceof Error ? e.message : "Unknown error"}`,
          );
          throw e;
        }
      }
    }
    console.log("Creating LlamaCloudIndex...");
    const index = new LlamaCloudIndex(createParams(params));
    console.log("LlamaCloudIndex created successfully");
    return index;
  } catch (error) {
    console.error(
      `Error in getDataSource: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    if (error instanceof Error && error.stack) {
      console.error(`Error stack: ${error.stack}`);
    }
    throw error;
  }
}

function createParams({
  project,
  pipeline,
}: LlamaCloudDataSourceParams): CloudConstructorParams {
  if (!pipeline) {
    throw new Error("Set pipeline in the params.");
  }
  const params = {
    organizationId: process.env.LLAMA_CLOUD_ORGANIZATION_ID,
    name: pipeline,
    projectName: project ?? process.env.LLAMA_CLOUD_PROJECT_NAME!,
    apiKey: process.env.LLAMA_CLOUD_API_KEY,
    baseUrl: process.env.LLAMA_CLOUD_BASE_URL,
    embedding_config: {
      model_name: "text-embedding-ada-002",
    },
  };
  console.log(
    `Created params: ${JSON.stringify({ ...params, apiKey: "[REDACTED]" })}`,
  );
  return params;
}

function checkEnvVars() {
  console.log("Checking environment variables...");
  if (
    !process.env.LLAMA_CLOUD_PROJECT_NAME ||
    !process.env.LLAMA_CLOUD_API_KEY
  ) {
    throw new Error(
      "LLAMA_CLOUD_PROJECT_NAME and LLAMA_CLOUD_API_KEY environment variables must be set.",
    );
  }
  console.log("Environment variables checked successfully");
}
