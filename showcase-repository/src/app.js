import express from "express";
import axios from "axios";
import _ from "lodash";

const app = express();
app.get("/health", (_request, response) => response.json({ status: "ok", service: _.upperFirst("inventory portal") }));
app.get("/catalog", async (_request, response) => {
  const catalog = await axios.get("https://example.com/catalog", { timeout: 2000 });
  response.json(catalog.data);
});
app.listen(8080);
