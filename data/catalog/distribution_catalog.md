# Metro Return-Distribution Catalog (Zillow ZHVI + ZORI)

1394 real metro return series fit through the engine. `sigma_ann_desmoothed` is the honest vol after Geltner de-smoothing (ZHVI is heavily index-smoothed). Feed any metro into score_opportunity as a base distribution.

## Zillow ZHVI (895 metros)

| source      | metro              | what        | start   | end     |   n_obs |   mu_ann |   sigma_ann_raw |   lag1_autocorr | smoothing_flag   |   sigma_ann_desmoothed |
|:------------|:-------------------|:------------|:--------|:--------|--------:|---------:|----------------:|----------------:|:-----------------|-----------------------:|
| Zillow ZHVI | United States      | Home Values | 2000-01 | 2026-04 |     315 |   0.0427 |          0.0186 |           0.978 | True             |                 0.1749 |
| Zillow ZHVI | New York, NY       | Home Values | 2000-01 | 2026-04 |     315 |   0.0467 |          0.0185 |           0.975 | True             |                 0.1641 |
| Zillow ZHVI | Los Angeles, CA    | Home Values | 2000-01 | 2026-04 |     315 |   0.0578 |          0.035  |           0.947 | True             |                 0.2119 |
| Zillow ZHVI | Chicago, IL        | Home Values | 2000-01 | 2026-04 |     315 |   0.0317 |          0.0205 |           0.944 | True             |                 0.1212 |
| Zillow ZHVI | Dallas, TX         | Home Values | 2000-01 | 2026-04 |     314 |   0.0404 |          0.0202 |           0.93  | True             |                 0.1061 |
| Zillow ZHVI | Houston, TX        | Home Values | 2000-01 | 2026-04 |     315 |   0.0349 |          0.0163 |           0.959 | True             |                 0.1122 |
| Zillow ZHVI | Washington, DC     | Home Values | 2000-01 | 2026-04 |     315 |   0.0452 |          0.0248 |           0.976 | True             |                 0.2254 |
| Zillow ZHVI | Philadelphia, PA   | Home Values | 2000-01 | 2026-04 |     315 |   0.0446 |          0.018  |           0.963 | True             |                 0.1315 |
| Zillow ZHVI | Miami, FL          | Home Values | 2000-01 | 2026-04 |     315 |   0.0561 |          0.0368 |           0.989 | True             |                 0.4911 |
| Zillow ZHVI | Atlanta, GA        | Home Values | 2000-01 | 2026-04 |     315 |   0.0364 |          0.0251 |           0.979 | True             |                 0.243  |
| Zillow ZHVI | Boston, MA         | Home Values | 2000-01 | 2026-04 |     315 |   0.0469 |          0.0197 |           0.958 | True             |                 0.1342 |
| Zillow ZHVI | Phoenix, AZ        | Home Values | 2000-01 | 2026-04 |     313 |   0.0455 |          0.0439 |           0.957 | True             |                 0.2962 |
| Zillow ZHVI | San Francisco, CA  | Home Values | 2000-01 | 2026-04 |     315 |   0.0535 |          0.0324 |           0.956 | True             |                 0.2167 |
| Zillow ZHVI | Riverside, CA      | Home Values | 2000-01 | 2026-04 |     315 |   0.0575 |          0.0428 |           0.977 | True             |                 0.3968 |
| Zillow ZHVI | Detroit, MI        | Home Values | 2000-01 | 2026-04 |     315 |   0.0299 |          0.0301 |           0.973 | True             |                 0.2566 |
| Zillow ZHVI | Seattle, WA        | Home Values | 2000-01 | 2026-04 |     315 |   0.0473 |          0.0293 |           0.956 | True             |                 0.197  |
| Zillow ZHVI | Minneapolis, MN    | Home Values | 2000-01 | 2026-04 |     315 |   0.038  |          0.0214 |           0.965 | True             |                 0.1596 |
| Zillow ZHVI | San Diego, CA      | Home Values | 2000-01 | 2026-04 |     315 |   0.0577 |          0.034  |           0.956 | True             |                 0.2257 |
| Zillow ZHVI | Tampa, FL          | Home Values | 2000-01 | 2026-04 |     315 |   0.0497 |          0.0348 |           0.984 | True             |                 0.3924 |
| Zillow ZHVI | Denver, CO         | Home Values | 2000-01 | 2026-04 |     315 |   0.0428 |          0.0209 |           0.958 | True             |                 0.1421 |
| Zillow ZHVI | Baltimore, MD      | Home Values | 2000-01 | 2026-04 |     315 |   0.0401 |          0.0211 |           0.97  | True             |                 0.1713 |
| Zillow ZHVI | St. Louis, MO      | Home Values | 2000-01 | 2026-04 |     315 |   0.0336 |          0.0148 |           0.948 | True             |                 0.091  |
| Zillow ZHVI | Orlando, FL        | Home Values | 2000-01 | 2026-04 |     315 |   0.0463 |          0.0369 |           0.987 | True             |                 0.4543 |
| Zillow ZHVI | Charlotte, NC      | Home Values | 2000-01 | 2026-04 |     315 |   0.0383 |          0.0193 |           0.975 | True             |                 0.1702 |
| Zillow ZHVI | San Antonio, TX    | Home Values | 2000-01 | 2026-04 |     315 |   0.0344 |          0.0168 |           0.953 | True             |                 0.1085 |
| Zillow ZHVI | Portland, OR       | Home Values | 2000-01 | 2026-04 |     315 |   0.0447 |          0.0246 |           0.968 | True             |                 0.1922 |
| Zillow ZHVI | Sacramento, CA     | Home Values | 2000-01 | 2026-04 |     315 |   0.0484 |          0.0373 |           0.977 | True             |                 0.3481 |
| Zillow ZHVI | Pittsburgh, PA     | Home Values | 2000-01 | 2026-04 |     315 |   0.0369 |          0.0127 |           0.867 | True             |                 0.0477 |
| Zillow ZHVI | Cincinnati, OH     | Home Values | 2000-01 | 2026-04 |     315 |   0.0337 |          0.0151 |           0.945 | True             |                 0.0896 |
| Zillow ZHVI | Austin, TX         | Home Values | 2000-01 | 2026-04 |     315 |   0.0344 |          0.0284 |           0.952 | True             |                 0.1818 |
| Zillow ZHVI | Las Vegas, NV      | Home Values | 2000-01 | 2026-04 |     315 |   0.0405 |          0.0471 |           0.977 | True             |                 0.4402 |
| Zillow ZHVI | Kansas City, MO    | Home Values | 2000-01 | 2026-04 |     315 |   0.041  |          0.0152 |           0.941 | True             |                 0.087  |
| Zillow ZHVI | Columbus, OH       | Home Values | 2000-01 | 2026-04 |     315 |   0.0369 |          0.016  |           0.95  | True             |                 0.1002 |
| Zillow ZHVI | Indianapolis, IN   | Home Values | 2000-01 | 2026-04 |     274 |   0.0399 |          0.0164 |           0.947 | True             |                 0.1    |
| Zillow ZHVI | Cleveland, OH      | Home Values | 2000-01 | 2026-04 |     315 |   0.0286 |          0.0159 |           0.945 | True             |                 0.0944 |
| Zillow ZHVI | San Jose, CA       | Home Values | 2000-01 | 2026-04 |     314 |   0.0585 |          0.042  |           0.912 | True             |                 0.1963 |
| Zillow ZHVI | Nashville, TN      | Home Values | 2000-01 | 2026-04 |     315 |   0.0448 |          0.019  |           0.971 | True             |                 0.158  |
| Zillow ZHVI | Virginia Beach, VA | Home Values | 2000-01 | 2026-04 |     315 |   0.0442 |          0.0196 |           0.974 | True             |                 0.1706 |
| Zillow ZHVI | Providence, RI     | Home Values | 2000-01 | 2026-04 |     315 |   0.0508 |          0.024  |           0.969 | True             |                 0.1929 |
| Zillow ZHVI | Jacksonville, FL   | Home Values | 2000-01 | 2026-04 |     315 |   0.0437 |          0.028  |           0.98  | True             |                 0.2772 |

## Zillow ZORI (499 metros)

| source      | metro              | what   | start   | end     |   n_obs |   mu_ann |   sigma_ann_raw |   lag1_autocorr | smoothing_flag   |   sigma_ann_desmoothed |
|:------------|:-------------------|:-------|:--------|:--------|--------:|---------:|----------------:|----------------:|:-----------------|-----------------------:|
| Zillow ZORI | United States      | Rents  | 2015-01 | 2026-04 |     135 |   0.0478 |          0.0155 |           0.897 | True             |                 0.0666 |
| Zillow ZORI | New York, NY       | Rents  | 2015-01 | 2026-04 |     135 |   0.0396 |          0.0266 |           0.906 | True             |                 0.1201 |
| Zillow ZORI | Los Angeles, CA    | Rents  | 2015-01 | 2026-04 |     135 |   0.0468 |          0.0142 |           0.843 | True             |                 0.0489 |
| Zillow ZORI | Chicago, IL        | Rents  | 2015-01 | 2026-04 |     135 |   0.0428 |          0.0207 |           0.849 | True             |                 0.0727 |
| Zillow ZORI | Dallas, TX         | Rents  | 2015-01 | 2026-04 |     135 |   0.0414 |          0.0188 |           0.874 | True             |                 0.0728 |
| Zillow ZORI | Houston, TX        | Rents  | 2015-01 | 2026-04 |     135 |   0.0276 |          0.0152 |           0.794 | True             |                 0.0451 |
| Zillow ZORI | Washington, DC     | Rents  | 2015-01 | 2026-04 |     135 |   0.0315 |          0.0185 |           0.843 | True             |                 0.0636 |
| Zillow ZORI | Philadelphia, PA   | Rents  | 2015-01 | 2026-04 |     135 |   0.042  |          0.0128 |           0.791 | True             |                 0.0376 |
| Zillow ZORI | Miami, FL          | Rents  | 2015-01 | 2026-04 |     135 |   0.055  |          0.0228 |           0.95  | True             |                 0.1428 |
| Zillow ZORI | Atlanta, GA        | Rents  | 2015-01 | 2026-04 |     135 |   0.0557 |          0.02   |           0.862 | True             |                 0.0737 |
| Zillow ZORI | Boston, MA         | Rents  | 2015-01 | 2026-04 |     135 |   0.0413 |          0.0262 |           0.84  | True             |                 0.0888 |
| Zillow ZORI | Phoenix, AZ        | Rents  | 2015-01 | 2026-04 |     135 |   0.0591 |          0.0224 |           0.882 | True             |                 0.0889 |
| Zillow ZORI | San Francisco, CA  | Rents  | 2015-01 | 2026-04 |     135 |   0.0341 |          0.022  |           0.854 | True             |                 0.0788 |
| Zillow ZORI | Riverside, CA      | Rents  | 2015-01 | 2026-04 |     135 |   0.0616 |          0.0167 |           0.816 | True             |                 0.0527 |
| Zillow ZORI | Detroit, MI        | Rents  | 2015-01 | 2026-04 |     135 |   0.0514 |          0.0147 |           0.769 | True             |                 0.0408 |
| Zillow ZORI | Seattle, WA        | Rents  | 2015-01 | 2026-04 |     135 |   0.0469 |          0.0272 |           0.839 | True             |                 0.0921 |
| Zillow ZORI | Minneapolis, MN    | Rents  | 2015-01 | 2026-04 |     135 |   0.0387 |          0.0141 |           0.709 | True             |                 0.0341 |
| Zillow ZORI | San Diego, CA      | Rents  | 2015-01 | 2026-04 |     135 |   0.0548 |          0.0187 |           0.874 | True             |                 0.0724 |
| Zillow ZORI | Tampa, FL          | Rents  | 2015-01 | 2026-04 |     135 |   0.0601 |          0.022  |           0.897 | True             |                 0.0947 |
| Zillow ZORI | Denver, CO         | Rents  | 2015-01 | 2026-04 |     135 |   0.0379 |          0.0232 |           0.852 | True             |                 0.082  |
| Zillow ZORI | Baltimore, MD      | Rents  | 2015-01 | 2026-04 |     135 |   0.034  |          0.0148 |           0.728 | True             |                 0.0375 |
| Zillow ZORI | St. Louis, MO      | Rents  | 2015-01 | 2026-04 |     135 |   0.0461 |          0.0128 |           0.714 | True             |                 0.0313 |
| Zillow ZORI | Orlando, FL        | Rents  | 2015-01 | 2026-04 |     135 |   0.0527 |          0.0216 |           0.893 | True             |                 0.0911 |
| Zillow ZORI | Charlotte, NC      | Rents  | 2015-01 | 2026-04 |     135 |   0.0511 |          0.0187 |           0.823 | True             |                 0.0603 |
| Zillow ZORI | San Antonio, TX    | Rents  | 2015-01 | 2026-04 |     135 |   0.0295 |          0.0174 |           0.831 | True             |                 0.0575 |
| Zillow ZORI | Portland, OR       | Rents  | 2015-01 | 2026-04 |     135 |   0.0441 |          0.021  |           0.839 | True             |                 0.0713 |
| Zillow ZORI | Sacramento, CA     | Rents  | 2015-01 | 2026-04 |     135 |   0.0575 |          0.0177 |           0.791 | True             |                 0.0521 |
| Zillow ZORI | Pittsburgh, PA     | Rents  | 2015-01 | 2026-04 |     135 |   0.0398 |          0.015  |           0.681 | True             |                 0.0345 |
| Zillow ZORI | Cincinnati, OH     | Rents  | 2015-01 | 2026-04 |     135 |   0.054  |          0.0138 |           0.602 | True             |                 0.0277 |
| Zillow ZORI | Austin, TX         | Rents  | 2015-01 | 2026-04 |     135 |   0.0289 |          0.0271 |           0.877 | True             |                 0.1062 |
| Zillow ZORI | Las Vegas, NV      | Rents  | 2015-01 | 2026-04 |     135 |   0.0536 |          0.0248 |           0.857 | True             |                 0.0895 |
| Zillow ZORI | Kansas City, MO    | Rents  | 2015-01 | 2026-04 |     135 |   0.0517 |          0.0147 |           0.741 | True             |                 0.0384 |
| Zillow ZORI | Columbus, OH       | Rents  | 2015-01 | 2026-04 |     135 |   0.0504 |          0.0182 |           0.635 | True             |                 0.0386 |
| Zillow ZORI | Indianapolis, IN   | Rents  | 2015-01 | 2026-04 |     135 |   0.0512 |          0.0164 |           0.74  | True             |                 0.0426 |
| Zillow ZORI | Cleveland, OH      | Rents  | 2015-01 | 2026-04 |     135 |   0.0519 |          0.0162 |           0.45  | True             |                 0.0263 |
| Zillow ZORI | San Jose, CA       | Rents  | 2015-01 | 2026-04 |     135 |   0.0324 |          0.0261 |           0.828 | True             |                 0.0854 |
| Zillow ZORI | Nashville, TN      | Rents  | 2015-01 | 2026-04 |     135 |   0.0427 |          0.022  |           0.772 | True             |                 0.0616 |
| Zillow ZORI | Virginia Beach, VA | Rents  | 2015-01 | 2026-04 |     135 |   0.0491 |          0.0167 |           0.774 | True             |                 0.047  |
| Zillow ZORI | Providence, RI     | Rents  | 2015-01 | 2026-04 |     135 |   0.0675 |          0.0229 |           0.51  | True             |                 0.0401 |
| Zillow ZORI | Jacksonville, FL   | Rents  | 2015-01 | 2026-04 |     135 |   0.0487 |          0.0198 |           0.831 | True             |                 0.0657 |

