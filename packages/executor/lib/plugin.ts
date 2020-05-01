import * as cdk from '@aws-cdk/core';
import * as sfn from '@aws-cdk/aws-stepfunctions';

export interface DataPlugin {

  version: '1';

  plugin: 'data';

  type: string;

  init: (host: PluginHost, platform: string) => void;

  import: (host: PluginHost, platform: string, data: any) => void;

  export: (host: PluginHost, platform: string, data: any) => void;
}

export interface PlatformPlugin {

  version: '1';

  pluginType: 'platform';
      
  type: string;

  taskType: string[];

  init: (host: PluginHost) => void;

  task: (host: PluginHost, type: string, task: any) => void;
}

export class PluginHost {
  static instance = new PluginHost();

  readonly hooks: { [key: string]: Function; } = {};
  readonly plugins: string[] = [];
  readonly task2Platform: {[key: string]: string}  = {};
  constructs: { [key: string]: any; } = {}; //TODO: too open

  id: string;

  commands: sfn.IChainable[] = [];
    
  constructor() {
    if (PluginHost.instance && PluginHost.instance !== this) {
      throw new Error('New instances of PluginHost must not be built. Use PluginHost.instance instead!');
    }
  }

  /**
   * Loads a plug-in into this PluginHost.
   *
   * @param moduleSpec the specification (path or name) of the plug-in module to be loaded.
   */
  public load(moduleSpec: string) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const plugin = require(moduleSpec);
      /* eslint-enable */
      if (isDataPlugin(plugin)) {
          this.hooks[`data.${plugin.type}.init`] = plugin.init;
          this.hooks[`data.${plugin.type}.import`] = plugin.import;
          this.hooks[`data.${plugin.type}.export`] = plugin.export;
      } else if (isPlatformPlugin(plugin)) {
          for(let i = 0; i < plugin.taskType.length; i++) {
            this.addTaskPlatformMapping(plugin.taskType[i], plugin.type);
          }
          this.hooks[`platform.${plugin.type}.init`] = plugin.init;
          this.hooks[`platform.${plugin.type}.task`] = plugin.task;
      } else {
        throw new Error(`Module ${moduleSpec} does not define a valid plug-in.`);
      }
      this.plugins.push(moduleSpec);
    function isDataPlugin(x: any): x is DataPlugin {
      return x != null && x.plugin === 'data' && x.version === '1';
    }
    function isPlatformPlugin(x: any): x is PlatformPlugin {
      return x != null && x.plugin === 'platform' && x.version === '1';
    }
  }

  private addTaskPlatformMapping(task: string, platform: string) {
    if(this.task2Platform[task]) {
        throw new Error(`Duplicate Task registered for ${task}`+
            ` between platforms ${this.task2Platform[task]} and ${platform}`);
    }
    this.task2Platform[task] = platform;
  }
}