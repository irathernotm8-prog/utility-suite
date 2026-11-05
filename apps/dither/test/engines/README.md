# Engine checks for character exports (optional, not part of npm test)

Loads Dither's exports in the real runtimes and compares every bone position with Dither's own rig.

    cd test/engines && npm i @esotericsoftware/spine-core@4.1.55   # once
    node mk.js                       # builds a test character into ./lib and exports it to ./out
    node spine.mjs                   # Spine 4.1 runtime: bones/slots/anims load, worst bone error (px)
    # Godot 4.3: make a project with out/* at res://characters/Knight/ and test.gd, then
    #   godot --headless --import --path gp ; godot --headless --path gp --script test.gd | grep RESULT > godot.json
    node cmp.js                      # worst bone error vs Godot (px), SpriteFrames animations

Last run (0.5.1): Spine side 0.03 px / front 0.66 px; Godot side ~0 px / front ≤ 2 px (stretched legs under a whole-body fall).
