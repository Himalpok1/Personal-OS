// Re-export the native module. On web, it will be resolved to ExactAlarmStatusModule.web.ts
// and on native platforms to ExactAlarmStatusModule.ts
export { default } from './src/ExactAlarmStatusModule';
export * from './src/ExactAlarmStatus.types';
