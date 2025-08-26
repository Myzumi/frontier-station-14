const path = require("path");

// Script Made by Myzumi
// Edit Variables here
const ShowContainerLogs = true; // Set to false to hide container logs
const ShipyardPath = path.join(__dirname, "..", "..", "..", "Resources", "Prototypes", "_NF", "Shipyard"); // Path to the shuttle files
const ShipRootPath = path.join(__dirname, "..", "..", "..", "Resources", "Maps", "_NF", "Shuttles"); // Path to the shuttle files
let MaxInstances = 2; // Maximum number of instances to run in parallel

// !! Do not edit below this line if you don't know what you're doing !!
// Developer Settings;
let Debug = false; // Set to true to enable debug mode, which will skip the 10 second wait and show more logs
const SkipBuild = false; // Set to true to skip the build process of the MapRenderer, Not Recommended due to the required Toolbox Fixes
//
const { exec } = require("child_process");
const { processRobustFiles } = require("./RobustToolboxFixes.js");
const fs = require("fs");
const YAML = require("yaml");
const chalk = require("chalk");
const Root = path.join(__dirname, "..", "..", "..");
const Logs = {}
let LockQueueClear = false;
const ShuttlePaths = {}

let DevFilter = [] // This should not be used. Only for testing purposes.

let SucceedShuttles = [];
let EditedShuttles = [];
let FailedShuttles = [];

const Tags = {
  info: chalk.bgWhite("[INFO]") + " ",
  error: chalk.bgRed("[ERROR]") + " ",
  warning: chalk.bgYellow("[WARNING]") + " ",
  debug: chalk.bgRed("[DEBUG]") + " ",
};
console.log(chalk.bgRed(chalk.yellow(`${chalk.bold("WARNING:")} This script will modify the RobustToolbox files!`)));
console.log(chalk.bgRed(chalk.yellow(`The Script will modify the EntityDeserializer.cs and MapLoaderSystem.Load.cs files!`)));
console.log(chalk.bgRed(chalk.yellow(`${chalk.bold("WARNING:")} This script will modify Ship files!`)));
console.log(chalk.bgRed(chalk.yellow(`The Script will modify Ship Mapping files and ${chalk.bold("WILL")} screw them up!`)));
console.log(chalk.bgRed(chalk.yellow(`The Script will continue in 15 seconds. Press Ctrl+C to cancel.`)));
if (process.env.GITHUB_ACTIONS) {
  console.log(Tags.info + chalk.yellow(`This script is running in a GitHub Actions environment. Forcing Debug mode.`));
  Debug = true;
  MaxInstances = 1;
}
if (process.env.ENABLE_DEBUG) {
  console.log(Tags.info + chalk.yellow("Debug mode enabled by environment variable."));
  Debug = true;
}
if (process.env.MAX_INSTANCES) {
  console.log(Tags.info + chalk.yellow(`Max instances set to ${process.env.MAX_INSTANCES} by environment variable.`));
  MaxInstances = parseInt(process.env.MAX_INSTANCES);
  if (isNaN(MaxInstances) || MaxInstances <= 0) {
    console.log(Tags.error + chalk.red("Invalid value for MAX_INSTANCES, defaulting to 2."));
    MaxInstances = 2;
  }
}
setTimeout(
  async () => {
    CleanUps();
    await processRobustFiles();
    init();
  },
  Debug ? 0 : 15000
);


function CleanUps() {
  if (fs.existsSync(path.join(__dirname, "ShuttleRenders")))
    fs.rmSync(path.join(__dirname, "ShuttleRenders"), { recursive: true, force: true });

  if (fs.existsSync(path.join(__dirname, "ShipyardData.json")))
    fs.rmSync(path.join(__dirname, "ShipyardData.json"), { recursive: true, force: true });

  if (fs.existsSync(path.join(__dirname, "statistic.json")))
    fs.rmSync(path.join(__dirname, "statistic.json"), { recursive: true, force: true });

  if (fs.existsSync(path.join(__dirname, "ShuttleBackups")))
    fs.rmSync(path.join(__dirname, "ShuttleBackups"), { recursive: true, force: true });

  if (!fs.existsSync(path.join(__dirname, "ShuttleBackups")))
    fs.mkdirSync(path.join(__dirname, "ShuttleBackups"), { recursive: true });

  if (!fs.existsSync(path.join(__dirname, "ShuttleRenders")))
    fs.mkdirSync(path.join(__dirname, "ShuttleRenders"), { recursive: true });
}
async function init() {
  let ShipyardTypes = await FindShuttleFiles(ShipyardPath);
  const AllShuttleToRender = [];
  const ShipyardData = {};

  ShipyardTypes.forEach((file) => {
    if (String(file).toLowerCase().includes("base")) return;
    let fileName = String(file).split("/").pop().toLowerCase();
    if (DevFilter.length !== 0 && !DevFilter.includes(String(fileName.replace(".yml", "")))) {
      if (Debug) console.log(Tags.debug + chalk.cyan(`Ignoring Shipyard File: ${file}`));
      return;
    }; // Only for testing purposes
    if (Debug) console.log(Tags.debug + chalk.cyan(`Found Shipyard File: ${file}`));
    const filePath = path.join(ShipyardPath, file);
    const fileContent = fs.readFileSync(filePath, "utf8");
    const yamlData = YAML.parse(fileContent, { logLevel: "error" });
    if (!yamlData[0].group) return;
    delete yamlData[0].parent;
    delete yamlData[0].type;
    if (!ShipyardData[yamlData[0].group]) ShipyardData[yamlData[0].group] = [];
    ShipyardData[yamlData[0].group].push(yamlData[0]);
    AllShuttleToRender.push(file);
    const relativePath = path.relative(__dirname, path.join(ShipRootPath, file)).replace(/\\/g, "/");
    ShuttlePaths[fileName] = relativePath;
  });

  if (AllShuttleToRender.length === 0) {
    console.log(Tags.error + chalk.red(`No Shuttles were found inside ${ShipyardPath}, exiting...`));
    return process.exit(1);
  }

  fs.writeFileSync(path.join(__dirname, "ShipyardData.json"), JSON.stringify(ShipyardData, null, 2), "utf8");

  let IsMapRendererBuilt = false;

  if (!SkipBuild) {
    console.log(chalk.yellow("Building MapRenderer..."));
    const BuildMapRenderer = exec(`cd ${Root} && dotnet build Content.MapRenderer/Content.MapRenderer.csproj`);
    AddExecLogs(BuildMapRenderer, "[MapRenderer]");
    BuildMapRenderer.on("close", () => {
      IsMapRendererBuilt = true;
      console.log(chalk.green("MapRenderer built successfully!"));
      console.log(chalk.yellow("Starting MapRenderer..."));
    });
  } else IsMapRendererBuilt = true;

  let CurrentInstances = 0;

  const Queue = setInterval(() => {
    if (!IsMapRendererBuilt) {
      if (Debug) console.log(Tags.debug + chalk.cyan("MapRenderer is not built yet, waiting..."));
      return;
    }
    if (AllShuttleToRender.length === 0 && CurrentInstances === 0) {
      if (LockQueueClear) return console.log(Tags.warning + chalk.yellow("Another Action is requiring a QueueLock, waiting for Action to end."));
      clearInterval(Queue);
      if (EditedShuttles.length !== 0) {
        EditedShuttles.forEach((shuttle) => {
          shuttle = shuttle + ".yml";
          const RelativePath = ShuttlePaths[shuttle];
          const BrokenShipPath = path.join(__dirname, RelativePath);
          fs.rmSync(BrokenShipPath, { recursive: true, force: true });
          const BackupPath = path.join(__dirname, "ShuttleBackups", shuttle);
          const BackupFile = fs.readFileSync(BackupPath, "utf8");
          fs.writeFileSync(BrokenShipPath, BackupFile, "utf8");
          fs.rmSync(BackupPath, { recursive: true, force: true });
          console.log(Tags.info + chalk.green(`Restored ${shuttle} from backup`));
        })
      }
      console.log(Tags.info + chalk.green("All shuttles have been rendered and it was cleaned up, Exiting..."));
      fs.writeFileSync(path.join(__dirname, "statistic.json"), JSON.stringify({ succeed: SucceedShuttles, edited: EditedShuttles, failed: FailedShuttles }, null, 2), "utf8");
      return;
    }
    if (CurrentInstances < MaxInstances) {
      if (AllShuttleToRender.length === 0) {
        if (Debug) console.log(Tags.debug + chalk.cyan("No Shuttles left to start rendering or last shuttles are still rendering..."));
        return;
      }
      let NextShipyardPath = AllShuttleToRender.shift();
      let ShuttleToRender = NextShipyardPath.split("/").pop();
      console.log(chalk.blue(`Starting MapRenderer for ${ShuttleToRender.split(".")[0]}, Taking ${PrettyPrintNumber(CurrentInstances + 1)} Slot, now at ${CurrentInstances + 1}/${MaxInstances} Instances, ${AllShuttleToRender.length} left to render`));
      const relativeShuttlePath = path.relative(path.join(Root, "Resources"), path.join(ShipRootPath, ShuttleToRender))
      const Command = `cd ${Root} && dotnet run --project Content.MapRenderer --files \\${relativeShuttlePath} --output ${path.join(__dirname, "ShuttleRenders")}`;
      ShuttleToRender = ShuttleToRender.split(".")[0];
      if (Debug)
        console.log(Tags.debug + chalk.cyan(`[${CurrentInstances + 1}-Render] Running ChildExec Command: ${Command}`));
      const RenderShuttle = exec(Command);
      AddExecLogs(RenderShuttle, `[#${CurrentInstances + 1}-Renderer-${ShuttleToRender}]`, ShuttleToRender);
      CurrentInstances++;
      RenderShuttle.on("close", () => {
        if (Debug) console.log(Tags.debug + chalk.cyan(`Instance ${ShuttleToRender} has finished, deducting one Instance. Now: ${CurrentInstances}/${MaxInstances} Instances`));
        CurrentInstances--;
        if (!FailedShuttles.includes(ShuttleToRender)) { console.log(Tags.info + chalk.green(`Finished MapRenderer for ${ShuttleToRender}`)) } else {
          if (EditedShuttles.includes(ShuttleToRender.split("/").pop())) {
            console.log(Tags.warning + chalk.yellow(`MapRenderer for ${ShuttleToRender} failed, but was already edited. Skipping Fixing process`));
            return;
          }
          console.log(Tags.warning + chalk.yellow(`child process failed, shuttle: ${ShuttleToRender}. Launching Fixing process`));
          LockQueueClear = true;
          let response = FixMappingFile(NextShipyardPath);
          if (response) {
            FailedShuttles = FailedShuttles.filter((shuttle) => shuttle !== response);
            EditedShuttles.push(response);
            AllShuttleToRender.push(response + ".yml");
            LockQueueClear = false;
          }
        }
      });
    } else {
      if (Debug) console.log(Tags.debug + chalk.cyan(`Max instances reached, waiting for next slot. (${CurrentInstances}/${MaxInstances})`));
    }
  }, 5000);
}

async function FindShuttleFiles(folderPath, shuttleFiles = [], rootFolder = folderPath) {
  const contents = fs.readdirSync(folderPath);

  for (const file of contents) {
    const filePath = path.join(folderPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      await FindShuttleFiles(filePath, shuttleFiles, rootFolder);
    } else {
      const relativePath = path.relative(rootFolder, filePath).replace(/\\/g, "/"); // Normalize to forward slashes
      shuttleFiles.push(relativePath);
    }
  }

  return shuttleFiles;
}

let ErrorTiggers = [
  "System.ArgumentException",
  "[ERRO]"
]

function AddExecLogs(exec, prefix = null, shuttle = null) {
  if (!ShowContainerLogs) return;

  function logData(data) {
    data = data.toString().trim();
    if (!data) return;
    if (!Logs[shuttle]) Logs[shuttle] = [];
    Logs[shuttle].push(data);

    let color = "gray";
    if (ErrorTiggers.some((trigger) => data.includes(trigger))) {
      color = "bgRed";
      prefix = Tags.error + (prefix || "");
      if (shuttle && !FailedShuttles.includes(shuttle)) {
        FailedShuttles.push(shuttle);
      }
    }

    console.log(chalk[color](`${prefix ? `${prefix} ` : ""}${data}`));
  }

  exec.stdout.on("data", logData);
  exec.stderr.on("data", logData);

  exec.on("close", (code) => {
    const color = "gray";
    console.log(chalk[color](`${prefix ? `${prefix} ` : ""}child process exited with code ${code}`));
    if (!FailedShuttles.includes(shuttle) && shuttle) {
      SucceedShuttles.push(shuttle);
      RenameMappedFile(shuttle);
      delete Logs[shuttle];
    }
  });
}

function RenameMappedFile(shuttle) {
  let ShipyardPath = path.join(__dirname, "ShuttleRenders", shuttle);
  const ShuttleName = shuttle.split(".")[0];
  let ShuttleFile = path.join(ShipyardPath, `${ShuttleName}-0.png`);
  let ShuttleFileNew = path.join(ShipyardPath, `${ShuttleName}.png`);
  if (fs.existsSync(ShuttleFile)) {
    fs.renameSync(ShuttleFile, ShuttleFileNew);
  } else {
    // The Linux version seem to uppercase the first letter of the shuttle name
    ShipyardPath = path.join(__dirname, "ShuttleRenders", shuttle.replace(/^./, str => str.toUpperCase()));
    ShuttleFileNew = path.join(ShipyardPath, `${ShuttleName}.png`);
    ShuttleFile = path.join(ShipyardPath, `${ShuttleName.replace(/^./, str => str.toUpperCase())}-0.png`);
    if (fs.existsSync(ShuttleFile)) {
      fs.renameSync(ShuttleFile, ShuttleFileNew);
    } else {
      // Scan the folder for the rendered file and rename it to the correct name
      const files = fs.readdirSync(ShipyardPath);
      const fileToRename = files.find(file => file.startsWith(ShuttleName) && file.endsWith(".png"));
      if (fileToRename) {
        const oldPath = path.join(ShipyardPath, fileToRename);
        fs.renameSync(oldPath, ShuttleFileNew);
        console.log(Tags.info + chalk.green(`Renamed ${fileToRename} to ${ShuttleName}.png`));
      } else {
        console.log(Tags.error + chalk.red(`Failed to find the rendered file for ${ShuttleName}`));
      }
    }
  }
}

function FixMappingFile(shuttle) {
  shuttle = shuttle.split("/").pop()
  let RelativePath = ShuttlePaths[shuttle];
  const BrokenShipyardPath = path.join(__dirname, RelativePath);
  const ShuttleName = shuttle.split(".")[0];
  let ShuttleFile = fs.readFileSync(BrokenShipyardPath, "utf8");
  fs.writeFileSync(path.join(__dirname, "ShuttleBackups", shuttle), ShuttleFile, "utf8");
  let ParsedFile = parseShuttle(ShuttleFile);
  let EditedShuttle = EditShuttle(ParsedFile, ShuttleName.replace(/_/g, " ").replace(/^./, str => str.toUpperCase()));
  fs.writeFileSync(BrokenShipyardPath, YAML.stringify(EditedShuttle), "utf8");
  console.log(Tags.info + chalk.cyan(`Edited Mapping File for ${ShuttleName}, trying to re-query MapRenderer`));
  return ShuttleName;
}

function EditShuttle(shuttle, ShuttleID) {
  let BecomesStation = shuttle["entities"][0]["entities"][0]["components"].find(component => component.type === "BecomesStation");
  if (!BecomesStation) { shuttle["entities"][0]["entities"][0]["components"].unshift({ type: "BecomesStation", id: ShuttleID }); } else {
    if (BecomesStation.id !== ShuttleID) {
      BecomesStation.id = ShuttleID;
    }
  }
  return shuttle;
}

function parseShuttle(data) {
  const doc = YAML.parseDocument(data, {
    strict: false,
    customTags: [
      {
        tag: "!type:SoundPathSpecifier",
        test: /^/,
        resolve(doc, node) {
          // Always return an empty string if there's no scalar value
          return node.strValue || "";
        },
      },
    ],
  });

  // Filter out the unresolved-tag warning
  doc.warnings = doc.warnings.filter((w) => w.code !== "TAG_RESOLVE_FAILED");
  return doc.toJSON();
}

function PrettyPrintNumber(number) {
  if (number === 1) return `${number}st`;
  if (number === 2) return `${number}nd`;
  if (number === 3) return `${number}rd`;
  return `${number}th`;
}
