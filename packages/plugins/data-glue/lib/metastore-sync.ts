import {PluginHost, MoonsetConstants as MC} from '@moonset/executor';
import * as EMR from 'aws-sdk/clients/emr';
import {SDKProvider, CDKResourceReader, S3AssetUploader} from '@moonset/util';
import {CommonConstants as C} from '@moonset/util';
import * as path from 'path';

export class MetastoreSync {
  static async getStepConfig(
      host: PluginHost,
      db: string,
      table: string,
      assumeRole: string|undefined,
      region: string|undefined,
      source: string,
      partition: {[k: string]: string}|undefined,
  ): Promise<EMR.Types.StepConfig> {
    const sdk = await SDKProvider.forWorkingAccount();
    const resources = new CDKResourceReader(host.session, sdk);
    const s3AssetUploader = new S3AssetUploader(
        await resources.findS3Bucket(MC.TAG_MOONSET_TYPE_LOG_S3_BUCEKT),
        'assets',
        host.session,
        host.id,
        sdk,
    );

    // TODO We can't find an existing S3 object without knowning its bucket
    // and key. Reference by tagging is not supported. S3 object is not CFN
    // Resource and only S3 bucket is.
    // Given above, we create the assets each time when we need. Although it's
    // duplicate a bit. Currently no better way is available.
    const script = await s3AssetUploader.uploadFile(
        path.resolve(__dirname, '..', 'script', 'metastore-sync.sh'),
    );

    if (!region) region = 'us-east-1';

    const args = [];
    args.push(
        script,
        '--database',
        db,
        '--table',
        table,
        '--source',
        source,
        '--region',
        region,
    );

    if (assumeRole) {
      args.push('--assume_role', assumeRole);
    }

    if (partition) {
      args.push(
          '--partition',
          Object.keys(partition).map(function(key) {
            return key +'=' + partition[key];
          }).join(';'),
      );
    }
    return {
      Name: 'MetastoreSync',
      ActionOnFailure: 'TERMINATE_CLUSTER',
      HadoopJarStep: {
        Properties: [],
        Jar: MC.SCRIPT_RUNNER,
        Args: args,
      },
    };
  }
}
