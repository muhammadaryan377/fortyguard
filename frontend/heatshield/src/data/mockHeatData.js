const WEST = -112.19;
const SOUTH = 33.372;
const LONGITUDE_STEP = 0.033;
const LATITUDE_STEP = 0.027;

const temperatures = [
  [28.9, 29.7, 30.8, 31.4, 31.0, 29.8, 28.8],
  [29.8, 31.2, 32.9, 34.0, 33.4, 31.6, 29.9],
  [30.8, 32.9, 35.0, 36.4, 35.9, 33.8, 31.1],
  [31.2, 33.8, 36.5, 38.7, 37.8, 35.0, 31.8],
  [30.5, 33.0, 35.6, 37.3, 36.6, 34.1, 31.0],
  [29.4, 31.2, 33.1, 34.5, 34.0, 32.0, 29.8],
];

const rounded = (value) => Number(value.toFixed(6));

const polygonForCell = (row, column) => {
  const west = WEST + column * LONGITUDE_STEP;
  const east = west + LONGITUDE_STEP;
  const south = SOUTH + row * LATITUDE_STEP;
  const north = south + LATITUDE_STEP;

  return [[
    [rounded(west), rounded(south)],
    [rounded(east), rounded(south)],
    [rounded(east), rounded(north)],
    [rounded(west), rounded(north)],
    [rounded(west), rounded(south)],
  ]];
};

export const mockHeatGeoJson = {
  type: "FeatureCollection",
  features: temperatures.flatMap((row, rowIndex) =>
    row.map((temperature, columnIndex) => ({
      type: "Feature",
      properties: {
        tile_id: rowIndex * row.length + columnIndex,
        average_temperature: temperature,
        min_temperature: rounded(temperature - 0.8),
        max_temperature: rounded(temperature + 0.9),
      },
      geometry: {
        type: "Polygon",
        coordinates: polygonForCell(rowIndex, columnIndex),
      },
    })),
  ),
};
