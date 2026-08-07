(() => {
  return { hello: "world", cid: window.location.href.match(/company_id=(\d+)/)?.[1] };
})()