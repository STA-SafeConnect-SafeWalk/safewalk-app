import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';
import {
  SNSClient,
  CreatePlatformApplicationCommand,
  DeletePlatformApplicationCommand,
  SetPlatformApplicationAttributesCommand,
} from '@aws-sdk/client-sns';

const sns = new SNSClient({});

export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceResponse> => {
  const { RequestType, ResourceProperties } = event;
  const { Name, Platform, PlatformCredential } = ResourceProperties;

  console.log('SNS Platform App Custom Resource:', RequestType, Name);

  try {
    switch (RequestType) {
      case 'Create': {
        const result = await sns.send(
          new CreatePlatformApplicationCommand({
            Name,
            Platform,
            Attributes: { PlatformCredential },
          }),
        );
        const arn = result.PlatformApplicationArn!;
        console.log('Created:', arn);
        return respond(event, 'SUCCESS', arn, { PlatformApplicationArn: arn });
      }

      case 'Update': {
        const existingArn = event.PhysicalResourceId;
        await sns.send(
          new SetPlatformApplicationAttributesCommand({
            PlatformApplicationArn: existingArn,
            Attributes: { PlatformCredential },
          }),
        );
        console.log('Updated:', existingArn);
        return respond(event, 'SUCCESS', existingArn, {
          PlatformApplicationArn: existingArn,
        });
      }

      case 'Delete': {
        const arn = event.PhysicalResourceId;
        try {
          await sns.send(
            new DeletePlatformApplicationCommand({
              PlatformApplicationArn: arn,
            }),
          );
          console.log('Deleted:', arn);
        } catch (err) {
          console.warn('Delete failed (non-fatal):', err);
        }
        return respond(event, 'SUCCESS', arn);
      }

      default:
        return respond(event, 'FAILED', 'unknown', undefined, `Unknown RequestType: ${RequestType}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error:', message);
    const physId =
      event.RequestType !== 'Create'
        ? (event as CloudFormationCustomResourceEvent & { PhysicalResourceId: string }).PhysicalResourceId
        : 'failed';
    return respond(
      event,
      'FAILED',
      physId,
      undefined,
      message,
    );
  }
};

function respond(
  event: CloudFormationCustomResourceEvent,
  status: 'SUCCESS' | 'FAILED',
  physicalResourceId: string,
  data?: Record<string, string>,
  reason?: string,
): CloudFormationCustomResourceResponse {
  return {
    Status: status,
    Reason: reason || '',
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  };
}
