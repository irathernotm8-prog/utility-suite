// Step-by-step install guides for the Upgrade tab. Plain data; app.js renders them.
window.GUIDES = {
  'ram-desktop': {
    title: 'Install memory in a desktop', time: '15 minutes', tools: ['A Phillips screwdriver (for the side panel, if it isn’t tool-free)'],
    before: ['Back up anything important (good habit before any upgrade).', 'Shut down, switch off the power supply at the back and unplug the cable.', 'Touch the metal case to discharge static before touching parts.'],
    steps: [
      'Lay the case on its side and remove the side panel (usually the left one, seen from the front).',
      'Find the memory slots next to the processor. Your motherboard manual or the labels on the board show which slots to fill first — usually A2 and B2 (the 2nd and 4th from the processor).',
      'Push the clips at the end of the slot outward.',
      'Line up the notch on the stick with the bump in the slot — it only fits one way.',
      'Press straight down firmly with both thumbs until the clips snap shut. It takes more force than you’d expect.',
      'Repeat for each stick, then put the panel back.'
    ],
    after: ['Plug in and power on. The first start can take a minute while the computer learns the new memory; the screen may stay black briefly.', 'If the sticks are rated faster than they run (check Vitals → This PC), turn on XMP/EXPO in the BIOS (press Del or F2 at start-up).', 'Come back here and press “Check my upgrade”.']
  },
  'ram-laptop': {
    title: 'Install memory in a laptop', time: '20–30 minutes', tools: ['A small Phillips screwdriver (some laptops need Torx T5)', 'A plastic pry tool or old guitar pick'],
    before: ['Back up your files.', 'Shut down (not sleep), unplug the charger.', 'If the battery is removable, take it out.'],
    steps: [
      'Look up your exact model on iFixit (link in the suggestion) to see where the memory is and which screws to remove.',
      'Remove the bottom cover screws — keep them in order, they can be different lengths.',
      'Gently pry the cover off, starting at a corner near the hinge.',
      'If the laptop has an internal battery cable, unplug it from the board before touching anything else.',
      'To remove a stick, push the two side clips outward; it pops up at an angle. Slide it out.',
      'Slide the new stick in at about 30°, notch lined up, then press down until the clips click.',
      'Reconnect the battery, refit the cover and screws.'
    ],
    after: ['The first start can take longer than usual — let it finish.', 'Come back here and press “Check my upgrade”.']
  },
  'ram-imac': {
    title: 'Install memory in an iMac or Mac with slots', time: '10–30 minutes', tools: ['Depends on the model — iFixit and OWC have model-specific guides'],
    before: ['Back up with Time Machine.', 'Shut down and unplug the power cord; wait 10 minutes for it to cool.'],
    steps: ['27-inch iMacs: lay the iMac face down on a soft towel, press the button above the power socket to open the memory door, and use the levers to lift out the cage.', 'Insert the new modules with the notch matched, pressing until they seat.', 'Push the cage back down and close the door.', 'Other models (Mac mini 2018, Mac Pro) need more disassembly — follow the OWC or iFixit video for your model.'],
    after: ['Turn it on; About This Mac › More Info should show the new total.', 'Come back here and press “Check my upgrade”.']
  },
  'ssd-add': {
    title: 'Add a second SSD', time: '20 minutes', tools: ['A Phillips screwdriver', 'For M.2: a tiny screw or tool-free latch (often on the board)'],
    before: ['Shut down, switch off and unplug.', 'Touch the case to discharge static.'],
    steps: [
      'M.2 NVMe: find a free M.2 slot on the motherboard (it may be under a metal heatsink — unscrew it). Insert the drive at a 30° angle, press it flat and fix it with the screw or latch.',
      'SATA (2.5-inch): mount it in a drive bay or bracket, connect a SATA data cable to the motherboard and a SATA power cable from the power supply.',
      'Close the case and start the computer.'
    ],
    after: ['A new drive is empty and needs setting up: on Windows open Disk Management (button below), choose GPT when asked, then right-click the unallocated space › New Simple Volume. On a Mac use Disk Utility › Erase › APFS.', 'Come back here and press “Check my upgrade”; the Drives tab can test its speed.'],
    tools2: ['disks']
  },
  'ssd-clone': {
    title: 'Move to a new SSD (keep everything)', time: '1–2 hours (mostly waiting)', tools: ['The new SSD', 'A USB-to-SATA or USB-to-NVMe adapter (about $15–25) for laptops with one slot', 'A screwdriver'],
    before: ['Back up your important files to an external drive or the cloud first.', 'Install a cloning tool: Macrium Reflect, or the free one from the SSD’s maker (Samsung Data Migration, Crucial’s Acronis edition, WD’s Acronis edition).'],
    steps: [
      'Connect the new SSD — inside a desktop, or through the USB adapter on a laptop.',
      'In the cloning tool, choose your current system drive as the source and the new SSD as the target. Let it resize partitions to fill the new drive.',
      'Start the clone and wait until it finishes.',
      'Shut down. Swap the new drive in where the old one was (laptops), or leave both in a desktop.',
      'Desktops with both drives: in the BIOS (Del/F2 at start-up) set the new SSD as the first boot drive.'
    ],
    after: ['Windows starts from the new drive exactly as before.', 'Once you’re happy, the old drive can be wiped and used for storage.', 'Come back here and press “Check my upgrade”.'],
    tools2: ['disks']
  },
  gpu: {
    title: 'Install a graphics card', time: '30 minutes', tools: ['A Phillips screwdriver'],
    before: ['Check the card fits: its length vs. the space in your case, and the slots it takes up (2–3 thick).', 'Check the power supply: the card maker lists a recommended wattage and the power connectors it needs (8-pin, or 12V-2x6 for newer NVIDIA cards).', 'If you’re replacing a card, uninstall its driver first (Settings › Apps), or use DDU for a clean switch between brands.', 'Shut down, switch off and unplug.'],
    steps: [
      'Remove the side panel. If there’s an old card, unplug its power cables, unscrew its bracket, press the small latch at the end of the slot and pull it out.',
      'Remove the metal slot covers on the back of the case where the new card will go.',
      'Line the card up with the top long PCIe x16 slot and press down until the latch clicks.',
      'Screw the bracket to the case and connect the power cables until they click.',
      'Plug your monitor into the graphics card, not the motherboard.'
    ],
    after: ['Start up and install the latest driver from NVIDIA, AMD or Intel (links in the Drivers tab).', 'Come back here and press “Check my upgrade”.']
  },
  'battery-mac': {
    title: 'Replace a Mac battery', time: 'Apple service: same day to a few days', tools: [],
    before: ['Back up with Time Machine.'],
    steps: ['Easiest: book a Genius Bar or Apple Authorized Service Provider appointment (link in the suggestion). Battery service has a fixed price.', 'Self Service Repair: Apple sells the genuine battery and rents the tools for recent MacBooks. It involves adhesive and is best for confident fixers.'],
    after: ['After the swap, Thermals & Power here should show health near 100%.']
  },
  'battery-laptop': {
    title: 'Replace a laptop battery', time: '20–40 minutes', tools: ['Screwdrivers for your model', 'Plastic pry tool'],
    before: ['Find the battery part number on the old battery or in the laptop’s service manual. Buy a genuine or well-reviewed replacement.', 'Run the battery below 25% before opening (safer).', 'Shut down and unplug.'],
    steps: ['Remove the bottom cover (iFixit has a guide for most models).', 'Unplug the battery cable from the motherboard first.', 'Remove the battery screws (or carefully release adhesive strips) and lift it out. Never bend or puncture it.', 'Fit the new battery, connect the cable and close up.'],
    after: ['Charge to 100% once. Vitals’ battery health should show close to 100%.', 'Take the old battery to an electronics recycling drop-off.']
  },
  'ext-ssd-mac': {
    title: 'Set up an external SSD on a Mac', time: '10 minutes', tools: ['A USB4/Thunderbolt or 10 Gb/s USB-C cable (use the one that came with the drive)'],
    before: [],
    steps: ['Plug the SSD into a USB-C port on the Mac directly — hubs can slow it down.', 'Open Disk Utility (button below), choose View › Show All Devices, select the drive (the top line) and click Erase.', 'Pick a name, Format: APFS, Scheme: GUID Partition Map, then Erase.', 'Move big folders across (Photos libraries, video projects, old downloads). For Photos, hold Option while opening Photos to point it at the moved library.'],
    after: ['Check its speed in the Drives tab here.', 'Time Machine can use a second external drive for automatic backups.'],
    tools2: ['disks']
  },
  win11: {
    title: 'Upgrade to Windows 11', time: '1 hour', tools: [],
    before: ['Back up your files.', 'Run PC Health Check (link in the suggestion) to confirm this PC qualifies.'],
    steps: ['Open Windows Update (button below) and check for updates.', 'If the Windows 11 upgrade is offered, choose Download and install. Your files and apps stay.', 'If the PC doesn’t qualify, it won’t get security fixes on Windows 10 any more — that’s the point to plan a replacement, and to avoid banking or sensitive work on it.'],
    after: ['Afterwards, check the Drivers tab for any devices that need attention.'],
    tools2: ['updates']
  }
};
