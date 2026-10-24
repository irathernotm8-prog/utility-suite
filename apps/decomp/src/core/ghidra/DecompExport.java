// Decomp: exports C pseudocode for every function, decompiled in parallel on all allowed cores.
// Args: <output folder>. Writes <program>.c (split into parts for big binaries) and functions.tsv.
//@category Decomp
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.parallel.DecompileConfigurer;
import ghidra.app.decompiler.parallel.DecompilerCallback;
import ghidra.app.decompiler.parallel.ParallelDecompiler;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Program;
import ghidra.util.task.TaskMonitor;
import java.io.File;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class DecompExport extends GhidraScript {
	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		File out = new File(args.length > 0 ? args[0] : "decomp-out");
		out.mkdirs();
		Program p = currentProgram;
		List<Function> funcs = new ArrayList<>();
		for (Function f : p.getFunctionManager().getFunctions(true)) {
			if (!f.isThunk() && !f.isExternal()) funcs.add(f);
		}
		final int total = funcs.size();
		println("DECOMP total " + total);
		final Map<Long, String[]> results = new ConcurrentHashMap<>();
		final AtomicInteger done = new AtomicInteger();
		DecompileConfigurer cfg = new DecompileConfigurer() {
			@Override
			public void configure(DecompInterface d) {
				d.toggleCCode(true);
				d.toggleSyntaxTree(false);
				d.setSimplificationStyle("decompile");
				DecompileOptions o = new DecompileOptions();
				o.grabFromProgram(p);
				d.setOptions(o);
			}
		};
		DecompilerCallback<Void> cb = new DecompilerCallback<Void>(p, cfg) {
			@Override
			public Void process(DecompileResults r, TaskMonitor m) throws Exception {
				Function f = r.getFunction();
				String c = r.getDecompiledFunction() != null ? r.getDecompiledFunction().getC()
					: "/* " + f.getName() + ": decompiler failed (" + r.getErrorMessage() + ") */\n";
				results.put(f.getEntryPoint().getOffset(), new String[] { f.getName(), f.getEntryPoint().toString(), c });
				int n = done.incrementAndGet();
				if (n % 25 == 0 || n == total) println("DECOMP progress " + n + " " + total);
				return null;
			}
		};
		cb.setTimeout(120);
		try {
			ParallelDecompiler.decompileFunctions(cb, funcs, monitor);
		}
		finally {
			cb.dispose();
		}
		String base = p.getName().replaceAll("[^A-Za-z0-9._-]", "_");
		TreeMap<Long, String[]> sorted = new TreeMap<>(results);
		int perFile = 1500, part = 0, inFile = 0, line = 1;
		PrintWriter w = null;
		String fileName = null;
		PrintWriter idx = new PrintWriter(new File(out, "functions.tsv"), StandardCharsets.UTF_8);
		idx.println("address\tname\tfile\tline");
		for (Map.Entry<Long, String[]> e : sorted.entrySet()) {
			if (w == null || inFile >= perFile) {
				if (w != null) w.close();
				part++;
				fileName = sorted.size() > perFile ? base + ".part" + part + ".c" : base + ".c";
				w = new PrintWriter(new File(out, fileName), StandardCharsets.UTF_8);
				w.println("// " + p.getName() + " — decompiled by Ghidra via Decomp");
				w.println("// Language: " + p.getLanguageID() + "   Compiler: " + p.getCompilerSpec().getCompilerSpecID());
				w.println();
				inFile = 0;
				line = 4;
			}
			String[] v = e.getValue();
			idx.println(v[1] + "\t" + v[0] + "\t" + fileName + "\t" + line);
			String body = "// " + v[0] + " @ " + v[1] + "\n" + v[2] + "\n";
			w.print(body);
			line += body.split("\n", -1).length - 1;
			inFile++;
		}
		if (w != null) w.close();
		idx.close();
		println("DECOMP done " + sorted.size());
	}
}
