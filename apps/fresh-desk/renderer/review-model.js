(function(scope){
  function visibleRows(rows, {age='all',group='',query='',sort='name',decision=''}={}) {
    const needle=query.toLowerCase();
    return rows.filter(r=>(!decision||decision==='review'&&r.confidence==='review'||decision==='duplicates'&&r.duplicate||decision==='protected'&&r.keep||decision==='conflicts'&&r.conflict)&&(age!=='old'||r.old)&&(age!=='recent'||!r.old)&&(!group||r.folder===group)&&`${r.name} ${r.from}`.toLowerCase().includes(needle)).sort((a,b)=>sort==='largest'?b.bytes-a.bytes:sort==='oldest'?a.modified.localeCompare(b.modified):sort==='group'?a.folder.localeCompare(b.folder)||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
  }
  function selectedVisible(rows, checked, filters) {return visibleRows(rows,filters).filter(r=>checked.has(r.id));}
  const api={visibleRows,selectedVisible};
  if(typeof module==='object')module.exports=api;else scope.reviewModel=api;
})(globalThis);
