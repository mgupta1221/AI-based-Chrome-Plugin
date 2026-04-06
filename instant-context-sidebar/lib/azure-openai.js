/**
 * Azure OpenAI API client reference module.
 * The actual calls are inlined in content.js since content scripts can't import modules.
 *
 * Config is read from config.json at extension root:
 * {
 *   "azure_openai": {
 *     "endpoint": "https://YOUR-RESOURCE-NAME.openai.azure.com",
 *     "deployment_name": "YOUR-DEPLOYMENT-NAME",
 *     "api_key": "YOUR-AZURE-OPENAI-API-KEY",
 *     "api_version": "2024-08-01-preview"
 *   }
 * }
 *
 * Azure OpenAI Chat Completions URL format:
 *   {endpoint}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}
 *
 * Headers:
 *   Content-Type: application/json
 *   api-key: {api_key}
 */
