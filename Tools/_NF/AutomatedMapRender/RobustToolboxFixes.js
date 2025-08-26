const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

if (fs.existsSync(path.join(__dirname, 'out'))) {
    fs.rmSync(path.join(__dirname, 'out'), { recursive: true, force: true });
}

const filesToModify = [
    {
        inputPath: path.join(__dirname, '..', '..', '..', 'RobustToolbox', 'Robust.Shared', 'EntitySerialization', 'Systems', 'MapLoaderSystem.Load.cs'),
        //outputPath: path.join(__dirname, 'out', 'MapLoaderSystem.Load.cs'),
        linesToComment: [103, 104, 105, 106, 107, 108, 109]
    }
];

function commentOutLinesByNumber(fileContent, linesToComment) {
    const lines = fileContent.split('\n');
    return lines.map((line, index) => {
        if (linesToComment.includes(index + 1)) { // Line numbers are 1-based
            if (!line.trim().startsWith('//')) { // Check if the line is already commented out
                return line.replace(/^(\s*)/, '$1// '); // Preserve indentation and prepend "// "
            }
        }
        return line;
    }).join('\n');
}

function processRobustFiles() {
    filesToModify.forEach(({ inputPath, outputPath, linesToComment }) => {
        try {
            const fileContent = fs.readFileSync(inputPath, 'utf8');
            const modifiedContent = commentOutLinesByNumber(fileContent, linesToComment);

            const targetPath = outputPath || inputPath; // Use inputPath if outputPath is not specified
            const outputDir = path.dirname(targetPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            fs.writeFileSync(targetPath, modifiedContent, 'utf8');
            console.log(chalk.yellow(`Successfully modified ${inputPath}`));
        } catch (error) {
            console.error(`Error processing file ${inputPath}:`, error);
        }
    });
}

module.exports = { processRobustFiles };
