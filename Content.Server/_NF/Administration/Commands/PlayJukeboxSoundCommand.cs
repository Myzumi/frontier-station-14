using Content.Shared.Administration;
using Content.Shared.Audio.Jukebox;
using Robust.Shared.Console;
using Robust.Shared.ContentPack;
using Robust.Shared.Prototypes;
using Robust.Shared.Audio.Systems;
using Robust.Shared.Audio;
using Robust.Server.Audio;

namespace Content.Server.Administration.Commands
{
    [AdminCommand(AdminFlags.Admin)]
    public sealed class PlayJukeboxSoundCommand : IConsoleCommand
    {
        [Dependency] private readonly IEntityManager _entManager = default!;
        [Dependency] private readonly IEntitySystemManager _entitySystemManager = default!;
        [Dependency] private readonly IPrototypeManager _protoManager = default!;
        [Dependency] private readonly IResourceManager _res = default!;


        public string Command => "playjukeboxsound";
        public string Description => "Plays the specified sound on the jukebox entity.";
        public string Help => "Usage: playjukeboxsound <entity uid> <sound path>";

        public void Execute(IConsoleShell shell, string argStr, string[] args)
        {
            if (args.Length != 2)
            {
                shell.WriteError(Loc.GetString("shell-wrong-arguments-number"));
                return;
            }

            if (!NetEntity.TryParse(args[0], out var entityUidNet) || !_entManager.TryGetEntity(entityUidNet, out var entityUid))
            {
                shell.WriteError(Loc.GetString("shell-entity-uid-must-be-number"));
                return;
            }

            if (!_entManager.HasComponent<JukeboxComponent>(entityUid))
            {
                shell.WriteError(Loc.GetString("play-jukebox-sound-command-not-jukebox"));
                return;
            }

            var Jukebox = _entManager.GetComponentOrNull<JukeboxComponent>(entityUid);
            if (Jukebox == null)
            {
                shell.WriteError(Loc.GetString("play-jukebox-sound-command-not-jukebox"));
                return;
            }

            var _audioSystem = _entitySystemManager.GetEntitySystem<AudioSystem>();

            //Jukebox.AudioStream =  (_audioSystem.PlayPvs(new SoundPathSpecifier(args[1]), entityUid.Value, AudioParams.Default.WithMaxDistance(10f)))?.Entity;



        }

        public CompletionResult GetCompletion(IConsoleShell shell, string[] args)
        {
            if (args.Length == 1)
            {
                return CompletionResult.FromHint(Loc.GetString("play-global-sound-command-arg-entity-uid"));
            }
            if (args.Length == 2)
            {
                var hint = Loc.GetString("play-global-sound-command-arg-path");

                var options = CompletionHelper.AudioFilePath(args[0], _protoManager, _res);

                return CompletionResult.FromHintOptions(options, hint);
            }

            return CompletionResult.Empty;
        }

    }

}
