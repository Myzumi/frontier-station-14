# Auto Shuttle Renderer

This Script needs Node.JS to be installed in order to run.
The Offered Versions at https://nodejs.org/ Should be sufficient.
This Script was programmed in Node.JS v22.11.0 and PNPM v9.14.2 (a replacement for npm)
If it is your first time using Node, run the following commands to get the Script running;
`npm install` (npm is installed with Node)
`node index.js`
And the script should start Running.

### WARNING!
This script will modify the RobustToolbox files by commenting out the following lines;

RobustToolbox\Robust.Shared\EntitySerialization\EntityDeserializer.cs:864-865
RobustToolbox\Robust.Shared\EntitySerialization\Systems\MapLoaderSystem.Load.cs:103-109

In order to Render Grid Maps.
If Upstream should change the Lines or add new content to the files, it is simple to change the lines inside the RobustToolboxFixes `filesToModify` Variable.
The Script will NOT Revert the Commented out lines, so if you Maintain or work with RobustToolbox you should revert these Lines afterwards.

### WARNING!
This Script will Modify Shuttle Files that will fail the Mapping Process due to a Missing Component (BecomesStation),
When the Script will Modify the said file.
It will Create a Backup before editing and restore it after the Process is Done, You should not exit beforehand.
The Console Will log which file will be edited for this, which can also be seen by an error with the MapRenderer


### The Script

This Script was written to be Automated and used combined with a Service to Display the Renders.
This will currently take all Shuttles existing in `Resources\Prototypes\_NF\Shipyard` but can be changed by editing the Path in index.js:8

The Script will grab all Shuttles and put them into a ShipyardData.json where things like Description, Price, Class etc is saved for each shipyard and ship.
This is Primarily used by the Frontier bot but can also be used by other Services.

After that, The Script will automatically build the MapRenderer.
Once Build it will start Converting the Shuttles to Images.

The Script has a build in Limit on how many Child Processes it will start, which can be changed at the beginning of the index.js file
All Images will end up inside ShuttleRenders/shipname/shipname.png (As Map.Renderer puts them out, but "-0" removed from the file names)

After the script has Finished running, it will put out a Statistic.json file, listing all Finished and Failed Shuttles at once.
