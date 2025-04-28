const path = require('path');

// Edit Variables here
const ShowContainerLogs = true; // Set to false to hide container logs
const Debug = true; // Set to true to enable debug mode, which will skip the 10 second wait and show more logs
const ShuttlePath = path.join(__dirname, '..', '..', '..', 'Resources', 'Prototypes', '_NF', 'Shipyard'); // Path to the shuttle files
const MaxInstances = 2; // Maximum number of instances to run in parallel

// !! Do not edit below this line if you don't know what you're doing !!

const { exec } = require('child_process');
const { processRobustFiles } = require('./RobustToolboxFixes.js');
const fs = require('fs');
const YAML = require('yaml');
const chalk = require('chalk');
const Root = path.join(__dirname, '..', '..', '..')

let SucceedShuttles = []
let FailedShuttles = []

const Tags = {
  info: chalk.bgWhite("[INFO]") + " ",
  error: chalk.bgRed("[ERROR]") + " ",
  warning: chalk.bgYellow("[WARNING]") + " ",
  debug: chalk.bgRed("[DEBUG]") + " "
}
console.log(chalk.bgRed(chalk.yellow(`WARNING: This script will modify the RobustToolbox files!`)))
console.log(chalk.bgRed(chalk.yellow(`The Script will modify the EntityDeserializer.cs and MapLoaderSystem.Load.cs files!`)))
console.log(chalk.bgRed(chalk.yellow(`The Script will continue in 10 seconds. Press Ctrl+C to cancel.`)))
setTimeout(async () => {
  await processRobustFiles();
  init()
}, Debug ? 0 : 10000);

if (fs.existsSync(path.join(__dirname, 'ShuttleRenders'))) fs.rmSync(path.join(__dirname, 'ShuttleRenders'), { recursive: true, force: true });
if (fs.existsSync(path.join(__dirname, 'ShipyardData.json'))) fs.rmSync(path.join(__dirname, 'ShipyardData.json'), { recursive: true, force: true });
if (!fs.existsSync(path.join(__dirname, 'ShuttleRenders'))) fs.mkdirSync(path.join(__dirname, 'ShuttleRenders'), { recursive: true });


async function init() {
  let ShipyardTypes = await FindShuttleFiles(ShuttlePath)
  const ShipyardData = {}
  const AllShuttleToRender = [];

  ShipyardTypes.forEach((file) => {
    if (String(file).toLowerCase().includes("base")) return;
    const filePath = path.join(ShuttlePath, file);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const yamlData = YAML.parse(fileContent, { logLevel: 'error' });
    if (!yamlData[0].group) return;
    delete yamlData[0].parent;
    delete yamlData[0].type;
    if (!ShipyardData[yamlData[0].group]) ShipyardData[yamlData[0].group] = [];
    ShipyardData[yamlData[0].group].push(yamlData[0]);
    AllShuttleToRender.push(file.split('/').pop());
  })

  fs.writeFileSync(path.join(__dirname, 'ShipyardData.json'), JSON.stringify(ShipyardData, null, 2), 'utf8');

  console.log(chalk.yellow("Building MapRenderer..."));
  let IsMapRendererBuilt = false;
  const BuildMapRenderer = exec(`cd ${Root} && dotnet build Content.MapRenderer/Content.MapRenderer.csproj`);
  AddExecLogs(BuildMapRenderer, "[MapRenderer]");
  BuildMapRenderer.on('close', () => {
    IsMapRendererBuilt = true;
    console.log(chalk.green("MapRenderer built successfully!"));
    console.log(chalk.yellow("Starting MapRenderer..."));
  })

  let CurrentInstances = 0;

  const Queue = setInterval(() => {
    if (!IsMapRendererBuilt) {
      if (Debug) console.log(Tags.debug + chalk.cyan("MapRenderer is not built yet, waiting..."));
      return;
    }
    if (AllShuttleToRender.length === 0 && CurrentInstances === 0) {
      clearInterval(Queue);
      console.log(chalk.green("All shuttles have been rendered!"));
      fs.writeFileSync(path.join(__dirname, 'statistic.json'), JSON.stringify({ succeed: SucceedShuttles, failed: FailedShuttles }, null, 2), 'utf8');
      return;
    }
    if (CurrentInstances < MaxInstances) {
      if (AllShuttleToRender.length === 0) {
        if (Debug) console.log(Tags.debug + chalk.cyan("No Shuttles left to start rendering or last shuttles are still rendering..."));
        return;
      };
      let ShuttleToRender = AllShuttleToRender.shift();
      console.log(chalk.blue(`Starting MapRenderer for ${ShuttleToRender.split('.')[0]}, Taking ${CurrentInstances + 1} Slot, now at ${CurrentInstances+1}/${MaxInstances}\n${AllShuttleToRender.length} left to render`));
      const Command = `cd ${Root} && dotnet run --project Content.MapRenderer --files ${ShuttleToRender} --output ${path.join(__dirname, 'ShuttleRenders')}`
      ShuttleToRender = ShuttleToRender.split('.')[0];
      if (Debug) console.log(Tags.debug + chalk.cyan(`[${CurrentInstances + 1}-Render] Running ChildExec Command: ${Command}`));
      const RenderShuttle = exec(Command);
      AddExecLogs(RenderShuttle, `[#${CurrentInstances + 1}-Renderer-${ShuttleToRender}]`, ShuttleToRender);
      CurrentInstances++;
      RenderShuttle.on('close', () => {
        CurrentInstances--;
        console.log(chalk.green(`Finished MapRenderer for ${ShuttleToRender}`));
        if (Debug) console.log(Tags.debug + chalk.cyan(`Instance ${ShuttleToRender} has finished, deducting one Instance. Now: ${CurrentInstances}/${MaxInstances}`));
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
      const relativePath = path.relative(rootFolder, filePath).replace(/\\/g, '/'); // Normalize to forward slashes
      shuttleFiles.push(relativePath);
    }
  }

  return shuttleFiles;
}

function AddExecLogs(exec, prefix = null, shuttle = null) {
  if (!ShowContainerLogs) return;
  exec.stdout.on('data', (data) => {
    data = data.toString().trim();
    if (!data) return;

    let color = 'gray';
    if (data.includes('[ERRO]')) {
      color = 'bgRed';
      prefix = Tags.error + (prefix || '');
      if (shuttle && !FailedShuttles.includes(shuttle)) {
        FailedShuttles.push(shuttle);
      }
    }

    console.log(chalk[color](`${prefix ? `${prefix} ` : ''}${data}`));
  });

  exec.stderr.on('data', (data) => {
    data = data.toString().trim();
    if (!data) return;

    let color = 'gray';
    if (data.includes('[ERRO]')) {
      color = 'bgRed';
      prefix = Tags.error + (prefix || '');
      if (shuttle && !FailedShuttles.includes(shuttle)) {
        FailedShuttles.push(shuttle);
      }
    }

    console.error(chalk[color](`${prefix ? `${prefix} ` : ''}${data}`));
  });

  exec.on('close', (code) => {
    const color = 'gray';
    console.log(chalk[color](`${prefix ? `${prefix} ` : ''}child process exited with code ${code}`));
    if (!FailedShuttles.includes(shuttle) && shuttle) {
      SucceedShuttles.push(shuttle);
      RenameMappedFile(shuttle);
    }
  });
}

function RenameMappedFile(shuttle) {
  const ShuttlePath = path.join(__dirname, 'ShuttleRenders', shuttle);
  const ShuttleName = shuttle.split('.')[0];
  const ShuttleFile = path.join(ShuttlePath, `${ShuttleName}-0.png`);
  const ShuttleFileNew = path.join(ShuttlePath, `${ShuttleName}.png`);
  if (fs.existsSync(ShuttleFile)) {
    fs.renameSync(ShuttleFile, ShuttleFileNew);
  } else {
    console.log(chalk.red(`Failed to rename ${ShuttleFile}, file does not exist.`));
  }
}
