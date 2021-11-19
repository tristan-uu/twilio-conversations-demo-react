import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { bindActionCreators } from "redux";
import { saveAs } from "file-saver";
import { VariableSizeList as List } from "react-window";
import InfiniteLoader from "react-window-infinite-loader";
import AutoSizer from "react-virtualized-auto-sizer";
import { useTheme } from "@twilio-paste/theme";
import {
  Conversation,
  Message,
  Media,
  Participant,
} from "@twilio/conversations";
import { Spinner } from "@twilio-paste/core";

import { getBlobFile, getMessageStatus } from "../../api";
import MessageView from "./MessageView";
import MessageFile from "./MessageFile";
import { actionCreators, AppState } from "../../store";
import ImagePreviewModal from "../modals/ImagePreviewModal";
import Horizon from "./Horizon";
import {
  successNotification,
  unexpectedErrorNotification,
} from "../../helpers";
import styles from "../../styles";

interface MessageListProps {
  messages: Message[];
  conversation: Conversation;
  participants: Participant[];
  lastReadIndex: number;
  hasMore: boolean;
  fetchMore: () => Promise<void>;
}

function getMessageTime(message: Message) {
  const dateCreated: Date = message.dateCreated;
  const today = new Date();
  const diffInDates = Math.floor(today.getTime() - dateCreated.getTime());
  const dayLength = 1000 * 60 * 60 * 24;
  const diffInDays = Math.floor(diffInDates / dayLength);
  const minutesLessThanTen = dateCreated.getMinutes() < 10 ? "0" : "";
  if (diffInDays === 0) {
    return (
      dateCreated.getHours().toString() +
      ":" +
      minutesLessThanTen +
      dateCreated.getMinutes().toString()
    );
  }
  return (
    dateCreated.getDate() +
    "/" +
    dateCreated.getMonth() +
    "/" +
    dateCreated.getFullYear().toString().substr(-2) +
    " " +
    dateCreated.getHours().toString() +
    ":" +
    minutesLessThanTen +
    dateCreated.getMinutes().toString()
  );
}

const MessageList: React.FC<MessageListProps> = (props: MessageListProps) => {
  const { messages, conversation, lastReadIndex } = props;
  if (messages === undefined) {
    return <div className="empty" />;
  }

  const theme = useTheme();
  const readHorizonRef = useRef<HTMLInputElement>(null);
  const messagesLength: number = messages.length;

  const dispatch = useDispatch();
  const { addAttachment, addNotifications } = bindActionCreators(
    actionCreators,
    dispatch
  );
  const conversationAttachments = useSelector(
    (state: AppState) => state.attachments[conversation.sid]
  );

  const [imagePreview, setImagePreview] = useState<{
    message: Message;
    file: Blob;
  } | null>(null);
  const [fileLoading, setFileLoading] = useState<Record<string, boolean>>({});

  const [horizonAmount, setHorizonAmount] = useState<number>(0);
  const [showHorizonIndex, setShowHorizonIndex] = useState<number>(0);
  const [scrolledToHorizon, setScrollToHorizon] = useState(false);

  useEffect(() => {
    if (scrolledToHorizon || !readHorizonRef.current) {
      return;
    }
    readHorizonRef.current.scrollIntoView({
      behavior: "smooth",
    });
    setScrollToHorizon(true);
  });

  useEffect(() => {
    if (lastReadIndex === -1 || horizonAmount) {
      return;
    }
    let showIndex = 0;

    setHorizonAmount(
      messages.filter(({ index }) => {
        if (index > lastReadIndex && !showIndex) {
          showIndex = index;
        }
        return index > lastReadIndex;
      }).length
    );

    setShowHorizonIndex(showIndex);
  }, [messages, lastReadIndex]);

  function setTopPadding(index: number) {
    if (
      props.messages[index] !== undefined &&
      props.messages[index - 1] !== undefined &&
      props.messages[index].author === props.messages[index - 1].author
    ) {
      return theme.space.space20;
    }
    return theme.space.space50;
  }

  const onDownloadAttachment = async (message: Message) => {
    setFileLoading(Object.assign({}, fileLoading, { [message.sid]: true }));
    const blob = await getBlobFile(message.media, addNotifications);
    addAttachment(props.conversation.sid, message.sid, blob);
    setFileLoading(Object.assign({}, fileLoading, { [message.sid]: false }));
  };

  const onFileOpen = (file: Blob, { filename }: Media) => {
    saveAs(file, filename);
  };

  const getMessageHeight = (index: number) => {
    const message = messages[index];
    let height = message.author === localStorage.getItem("username") ? 98 : 93; // empty message block with/without statuses
    height += 24; // padding top & bottom

    // calculating media message height
    if (message.media) {
      if (message.media.contentType.includes("image")) {
        return (height += 200);
      }

      return (height += 71); // file view height
    }

    // calculating text message height
    const words = message.body.split(" ");
    let lineChars = 0;

    if (words.length) {
      height += 17;
    }

    words.forEach((word) => {
      if (lineChars + word.length < 75) {
        if (lineChars == 0) {
          lineChars = word.length;
        } else {
          lineChars += word.length + 1;
        }
      } else {
        height += 17;
        lineChars = word.length;
      }
    });

    return height;
  };

  const { hasMore, fetchMore } = props;
  const isItemLoaded = (index: number) => !hasMore || index < messages?.length;

  return (
    <>
      <AutoSizer>
        {({ height, width }) => (
          <InfiniteLoader
            isItemLoaded={isItemLoaded}
            itemCount={hasMore ? messages?.length + 1 : messages?.length}
            loadMoreItems={fetchMore}
          >
            {({ onItemsRendered, ref }) => (
              <List
                height={height}
                itemCount={hasMore ? messages?.length + 1 : messages?.length}
                itemSize={getMessageHeight}
                onItemsRendered={onItemsRendered}
                ref={ref}
                width={width}
                style={{ transform: "matrix(1, 0, 0, -1, 0, 0)" }}
              >
                {({ index, style }) => {
                  let content;
                  if (!isItemLoaded(index)) {
                    content = (
                      <div style={{ ...styles.paginationSpinner, ...style }}>
                        <Spinner
                          decorative={false}
                          size="sizeIcon50"
                          title="Loading"
                        />
                      </div>
                    );
                  } else {
                    const message = messages[index];
                    const isImage =
                      message.media?.contentType?.includes("image");
                    const fileBlob =
                      conversationAttachments?.[message.sid] ?? null;

                    content = (
                      <div
                        key={
                          message.dateCreated.getTime() +
                          message.body +
                          message.media?.filename +
                          message.sid
                        }
                        style={{
                          ...style,
                          ...{ transform: "matrix(1, 0, 0, -1, 0, 0)" },
                        }}
                      >
                        {lastReadIndex !== -1 &&
                        horizonAmount &&
                        showHorizonIndex === message.index ? (
                          <Horizon
                            ref={readHorizonRef}
                            amount={horizonAmount}
                          />
                        ) : null}
                        <MessageView
                          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                          // @ts-ignore
                          reactions={message.attributes["reactions"]}
                          message={
                            message.body ||
                            (message.media ? (
                              <MessageFile
                                key={message.sid}
                                media={message.media}
                                type="view"
                                onDownload={() => onDownloadAttachment(message)}
                                isImage={isImage}
                                file={fileBlob}
                                sending={message.index === -1}
                                loading={fileLoading[message.sid]}
                                onOpen={
                                  isImage && fileBlob
                                    ? () =>
                                        setImagePreview({
                                          message,
                                          file: fileBlob,
                                        })
                                    : () =>
                                        onFileOpen(
                                          conversationAttachments?.[
                                            message.sid
                                          ],
                                          message.media
                                        )
                                }
                              />
                            ) : (
                              ""
                            ))
                          }
                          author={message.author}
                          getStatus={getMessageStatus(
                            props.conversation,
                            message,
                            props.participants
                          )}
                          onDeleteMessage={async () => {
                            try {
                              await message.remove();
                              successNotification({
                                message: "Message deleted.",
                                addNotifications,
                              });
                            } catch {
                              unexpectedErrorNotification(addNotifications);
                            }
                          }}
                          topPadding={setTopPadding(index)}
                          lastMessageBottomPadding={
                            index === messagesLength - 1 ? 16 : 0
                          }
                          sameAuthorAsPrev={
                            setTopPadding(index) !== theme.space.space20
                          }
                          messageTime={getMessageTime(message)}
                          updateAttributes={(attribute) =>
                            message.updateAttributes({
                              ...message.attributes,
                              ...attribute,
                            })
                          }
                        />
                      </div>
                    );
                  }

                  return <>{content}</>;
                }}
              </List>
            )}
          </InfiniteLoader>
        )}
      </AutoSizer>
      {imagePreview
        ? (function () {
            const date = new Date(imagePreview?.message.dateCreated);
            return (
              <ImagePreviewModal
                image={imagePreview.file}
                isOpen={!!imagePreview}
                author={imagePreview?.message.author}
                date={
                  date.toDateString() +
                  ", " +
                  date.getHours() +
                  ":" +
                  (date.getMinutes() < 10 ? "0" : "") +
                  date.getMinutes()
                }
                handleClose={() => setImagePreview(null)}
                onDownload={() =>
                  saveAs(imagePreview.file, imagePreview.message.media.filename)
                }
              />
            );
          })()
        : null}
    </>
  );
};

export default MessageList;
