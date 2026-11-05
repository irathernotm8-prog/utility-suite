extends SceneTree
var done = false
func _process(_d):
	if done: return true
	done = true
	var out = {}
	for view in ["side", "front"]:
		var ps = load("res://characters/Knight/Knight %s.tscn" % view)
		if ps == null:
			print("LOADFAIL ", view); continue
		var inst = ps.instantiate()
		root.add_child(inst)
		var ap = inst.get_node("AnimationPlayer")
		var anims = {}
		for a in ap.get_animation_list():
			var frames = []
			var anim = ap.get_animation(a)
			var step = anim.step
			for f in [0, 2, 4]:
				ap.stop(); ap.play(a); ap.seek(f * step, true)
				var bones = {}
				for n in ["root/hips/torso/head", "root/hips/thigh_f/shin_f/foot_f", "root/hips/torso/upper_arm_f/lower_arm_f/hand_f"]:
					var node = inst.get_node(n)
					bones[n.get_file()] = [node.global_position.x, node.global_position.y]
				frames.append({"f": f, "b": bones})
			anims[a] = frames
		var sprites = 0
		for c in inst.find_children("*", "Sprite2D", true, false):
			if c.texture != null: sprites += 1
		out[view] = {"anims": anims, "sprites": sprites}
	var sf = load("res://characters/Knight/Knight frames.tres")
	out["spriteframes"] = sf.get_animation_names() if sf != null else "LOADFAIL"
	print("RESULT " + JSON.stringify(out))
	quit()
	return true
