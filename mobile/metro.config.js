const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.blockList = [
  /.*\/desktop\/src-tauri\/target\/.*/,
  /.*\/android\/\.gradle\/.*/,
  /.*\/android\/app\/build\/.*/,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

// react-native-webrtc@124 has a broken package.json: the "react-native" field
// points at "src/index.ts" but no src/ folder is shipped. Locate the actual
// entry file once and hard-remap requests for the package to it.
function locateWebrtcEntry() {
  const candidates = [
    path.join(projectRoot, "node_modules", "react-native-webrtc", "lib", "module", "index.js"),
    path.join(workspaceRoot, "node_modules", "react-native-webrtc", "lib", "module", "index.js"),
    path.join(projectRoot, "node_modules", "react-native-webrtc", "lib", "commonjs", "index.js"),
    path.join(workspaceRoot, "node_modules", "react-native-webrtc", "lib", "commonjs", "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "react-native-webrtc entry file not found in any of:\n  " + candidates.join("\n  ")
  );
}

const webrtcEntry = locateWebrtcEntry();
console.log("[metro.config] react-native-webrtc entry:", webrtcEntry);

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-webrtc") {
    return { type: "sourceFile", filePath: webrtcEntry };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
