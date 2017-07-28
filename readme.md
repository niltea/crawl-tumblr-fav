TumblrのLikesを自動で取得して画像を保存するやつ

## 必要な環境
AWS Lambda + Dynamo DBでの動作を念頭に作成しています

## 設定
環境変数に各種クレデンシャル等を入れる。
詳細はenv_sample.shを参照のこと。  

Tumblr APIのtoken, token_secret は[こちら](https://api.tumblr.com/console/calls/user/info)より取得可。

## ローカルでのテスト
`source env.sh` で環境変数をセット。  
`yarn start` or `node start.js` で走ります。
