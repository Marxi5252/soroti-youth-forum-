// 1. MODULE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  push, 
  onValue, 
  off,
  query,
  limitToLast,
  update, 
  remove, 
  set, 
  get,
  onDisconnect,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. FIREBASE CONFIG & INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyA0BCPLt-9TvXtmPLCRq6Y45AijoUnkB48", 
  authDomain: "soroti-youth-forum.firebaseapp.com",
  projectId: "soroti-youth-forum",
  storageBucket: "soroti-youth-forum.firebasestorage.app",
  messagingSenderId: "1005832853294",
  appId: "1:1005832853294:web:bf61ea5749abf833688cbf",
  measurementId: "G-CHRVZQV6H6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

// 3. GLOBAL STATE
let postsList = [];
let usersList = [];
let friendsList = [];
let userBookmarks = {};
let pendingRequests = [];
let sentRequests = [];
let currentUser = null;
let postsLimit = 25;
let currentPostsQueryRef = null;

// Modal Pagination & User State
let modalCurrentUid = null;
let modalPostsLimit = 5;

let activeChatRoom = null;
let activeChatRecipientUid = null;
let activeChatRecipientName = null;
let activeChatRef = null;
let activeChatCallback = null;
let activeTypingListenerRef = null;
let activeTypingListenerCallback = null;

let notifRef = null;
let notifCallback = null;
let friendsRef = null;
let friendsCallback = null;
let bookmarksRef = null;
let bookmarksCallback = null;
let requestsRef = null;
let requestsCallback = null;
let sentRequestsRef = null;
let sentRequestsCallback = null;
let connectedRef = null;
let connectedCallback = null;

let currentPostFile = null;
let currentChatFile = null;
let currentCallStream = null;

let typingTimeout = null;
let lastFocusedInput = null;

// 4. HELPER FUNCTIONS
function timeAgo(timestamp) {
  if (!timestamp) return 'Recently';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function compressImage(file, maxWidth = 1000, quality = 0.75) {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now()
          }));
        }, file.type, quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function uploadMediaFile(file, folderPath) {
  if (!file) return null;

  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB Limit
  if (file.size > MAX_SIZE_BYTES) {
    showToast("File size exceeds 5MB upload limit.");
    return null;
  }

  try {
    const fileToUpload = file.type.startsWith('image/') ? await compressImage(file) : file;
    const uniqueFileName = `${crypto.randomUUID()}_${fileToUpload.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fileReference = storageRef(storage, `${folderPath}/${uniqueFileName}`);
    await uploadBytes(fileReference, fileToUpload);
    return await getDownloadURL(fileReference);
  } catch (error) {
    console.warn("Storage upload warning:", error);
    showToast("Cloud Storage upload failed.");
    return null;
  }
}

function getInitials(name) {
  return name ? name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2) : 'SY';
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function applyAvatarStyle(element, avatarUrl, name) {
  if (!element) return;
  if (avatarUrl) {
    element.style.backgroundImage = `url("${avatarUrl}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.textContent = '';
  } else {
    element.style.backgroundImage = 'none';
    element.textContent = getInitials(name);
  }
}

export async function sendNotification(targetUid, title, message, icon = 'fa-bell') {
  if (!targetUid) return;
  try {
    const targetNotifRef = ref(database, `notifications/${targetUid}`);
    await push(targetNotifRef, {
      title: title,
      message: message,
      icon: icon,
      read: false,
      createdAt: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    triggerDesktopPush(title, message);
  } catch (err) {
    console.warn("Could not dispatch notification:", err);
  }
}

function triggerDesktopPush(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "logo.png" });
  }
}

function showToast(message) {
  const toastNotice = document.getElementById('toastNotice');
  const toastText = document.getElementById('toastMsgText');
  if (!toastNotice || !toastText) return;
  toastText.innerHTML = message;
  toastNotice.style.display = 'flex';
  setTimeout(() => { toastNotice.style.display = 'none'; }, 4000);
}

function getCurrentSearchQuery() {
  const searchInput = document.getElementById('searchInput');
  return searchInput ? searchInput.value.trim() : '';
}

function setupPresenceSystem(user) {
  if (!user) return;
  
  if (connectedRef && connectedCallback) {
    off(connectedRef, 'value', connectedCallback);
  }

  connectedRef = ref(database, ".info/connected");
  const userStatusRef = ref(database, `users/${user.uid}/isOnline`);
  const userLastSeenRef = ref(database, `users/${user.uid}/lastSeen`);

  connectedCallback = (snapshot) => {
    if (snapshot.val() === false) return;
    onDisconnect(userStatusRef).set(false).then(() => {
      onDisconnect(userLastSeenRef).set(serverTimestamp());
      set(userStatusRef, true);
      set(userLastSeenRef, serverTimestamp());
    });
  };

  onValue(connectedRef, connectedCallback);
}

function detachUserListeners() {
  if (notifRef && notifCallback) off(notifRef, 'value', notifCallback);
  if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
  if (bookmarksRef && bookmarksCallback) off(bookmarksRef, 'value', bookmarksCallback);
  if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
  if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
  if (connectedRef && connectedCallback) off(connectedRef, 'value', connectedCallback);
  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  if (activeTypingListenerRef && activeTypingListenerCallback) off(activeTypingListenerRef, 'value', activeTypingListenerCallback);

  notifRef = null; notifCallback = null;
  friendsRef = null; friendsCallback = null;
  bookmarksRef = null; bookmarksCallback = null;
  requestsRef = null; requestsCallback = null;
  sentRequestsRef = null; sentRequestsCallback = null;
  connectedRef = null; connectedCallback = null;
  activeChatRef = null; activeChatCallback = null;
  activeTypingListenerRef = null; activeTypingListenerCallback = null;
}

function closeDrawer() {
  const navDrawer = document.getElementById('navDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  if (navDrawer) navDrawer.classList.remove('open');
  if (drawerOverlay) drawerOverlay.classList.remove('active');
}

// 5. GLOBAL INTERACTIVE WINDOW FUNCTIONS

window.navigateToPost = function(postId) {
  const profileModal = document.getElementById('profileModal');
  if (profileModal) profileModal.classList.add('hidden');

  window.switchTab('posts');

  setTimeout(() => {
    let postEl = document.getElementById(`post-${postId}`);
    if (!postEl) {
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value) {
        searchInput.value = '';
      }
      renderFeed('');
      postEl = document.getElementById(`post-${postId}`);
    }

    if (postEl) {
      postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      postEl.classList.remove('highlight-post');
      void postEl.offsetWidth;
      postEl.classList.add('highlight-post');
      showToast('Navigated to post.');
    } else {
      showToast('Post could not be located in feed.');
    }
  }, 150);
};

window.openAvatarLightbox = function(avatarUrl, userName) {
  const lightboxModal = document.getElementById('avatarLightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxFallback = document.getElementById('lightboxFallbackAvatar');
  const lightboxName = document.getElementById('lightboxUserName');

  if (!lightboxModal) return;

  if (lightboxName) lightboxName.textContent = `${userName || 'Member'}'s Profile Picture`;

  if (avatarUrl) {
    if (lightboxImg) {
      lightboxImg.src = avatarUrl;
      lightboxImg.classList.remove('hidden');
    }
    if (lightboxFallback) lightboxFallback.classList.add('hidden');
  } else {
    if (lightboxImg) lightboxImg.classList.add('hidden');
    if (lightboxFallback) {
      lightboxFallback.classList.remove('hidden');
      lightboxFallback.style.backgroundImage = 'none';
      lightboxFallback.textContent = getInitials(userName);
    }
  }

  lightboxModal.classList.remove('hidden');
};

window.toggleBookmark = async function(button, postId) {
  if (!currentUser) {
    showToast("Please log in to bookmark posts.");
    return;
  }
  try {
    const bookmarkRef = ref(database, `users/${currentUser.uid}/bookmarks/${postId}`);
    const snapshot = await get(bookmarkRef);
    
    if (snapshot.exists()) {
      await remove(bookmarkRef);
      if (button) button.classList.remove('active');
      showToast("Bookmark removed.");
    } else {
      await set(bookmarkRef, Date.now());
      if (button) button.classList.add('active');
      showToast("Post bookmarked!");
    }
  } catch (err) {
    console.error("Failed to toggle bookmark:", err);
  }
};

window.triggerTypingStatus = function() {
  if (!currentUser || !activeChatRoom) return;
  const typingRef = ref(database, `typing/${activeChatRoom}/${currentUser.uid}`);
  set(typingRef, true);
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    set(typingRef, false);
  }, 2000);
};

window.toggleEmojiPicker = function(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('emoji-picker-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
};

window.insertEmoji = function(emoji) {
  const activeInput = lastFocusedInput || document.getElementById('chatInput') || document.getElementById('postText');
  if (activeInput) {
    const start = activeInput.selectionStart || 0;
    const end = activeInput.selectionEnd || 0;
    const text = activeInput.value;
    activeInput.value = text.substring(0, start) + emoji + text.substring(end);
    activeInput.selectionStart = activeInput.selectionEnd = start + emoji.length;
    activeInput.focus();
  }
  document.getElementById('emoji-picker-dropdown')?.classList.add('hidden');
};

window.markMessagesRead = async function(chatRoomId) {
  if (!currentUser || !chatRoomId) return;
  try {
    const chatRef = ref(database, `chats/${chatRoomId}`);
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const updates = {};
      Object.entries(snapshot.val()).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) {
          updates[`${msgId}/read`] = true;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(chatRef, updates);
      }
    }
  } catch (err) {
    console.error("Failed to mark messages read:", err);
  }
};

function renderModalUserPosts() {
  const container = document.getElementById('modalUserPostsContainer');
  const badge = document.getElementById('modalPostsCountBadge');
  if (!container) return;

  const userPosts = postsList.filter(p => p.uid === modalCurrentUid);
  if (badge) badge.textContent = `${userPosts.length} posts`;

  if (userPosts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No posts shared yet.</div>`;
    return;
  }

  const visiblePosts = userPosts.slice(0, modalPostsLimit);

  container.innerHTML = visiblePosts.map(post => {
    const displayTime = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');
    let attachmentHTML = '';
    if (post.attachment) {
      const type = post.attachmentType || '';
      if (type === 'image') {
        attachmentHTML = `<img src="${escapeHTML(post.attachment)}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-top: 6px;" />`;
      } else if (type === 'video') {
        attachmentHTML = `<video src="${escapeHTML(post.attachment)}" controls style="width: 100%; max-height: 180px; border-radius: 6px; margin-top: 6px;"></video>`;
      }
    }

    return `
      <div class="modal-post-item" onclick="navigateToPost('${post.id}')" style="background: var(--item-hover-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; margin-bottom: 8px; text-align: left; cursor: pointer; transition: transform 0.2s, border-color 0.2s;" onmouseover="this.style.borderColor='var(--color-red)'" onmouseout="this.style.borderColor='var(--border-color)'" title="Click to view post in main feed">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.7; margin-bottom: 4px;">
          <span><i class="fa-regular fa-clock"></i> ${escapeHTML(displayTime)}</span>
          <span style="color: var(--color-red); font-weight: bold;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View Post</span>
        </div>
        ${post.content ? `<p style="font-size: 13px; line-height: 1.4; margin: 0;">${escapeHTML(post.content)}</p>` : ''}
        ${attachmentHTML}
      </div>
    `;
  }).join('');

  if (modalPostsLimit < userPosts.length) {
    container.innerHTML += `<div style="text-align: center; font-size: 11px; color: #888; padding: 8px 0; cursor: pointer;" onclick="modalPostsLimit+=5; renderModalUserPosts();"><i class="fa-solid fa-arrows-rotate"></i> Load more user posts...</div>`;
  }
}

window.openUserProfile = function(uid) {
  let user = usersList.find(u => u.uid === uid);
  
  if (!user && currentUser && currentUser.uid === uid) {
    user = currentUser;
  }

  if (!user) return;

  const modal = document.getElementById('profileModal');
  const nameEl = document.getElementById('modalProfileName');
  const emailEl = document.getElementById('modalProfileEmail');
  const avatarEl = document.getElementById('modalProfileAvatar');
  const statusEl = document.getElementById('modalProfileStatus');
  const postCountEl = document.getElementById('modalProfilePostCount');
  const actionsEl = document.getElementById('modalProfileActions');

  const displayName = user.displayName || user.name || 'Member';

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = user.email || '';
  
  applyAvatarStyle(avatarEl, user.avatarUrl, displayName);

  if (avatarEl) {
    avatarEl.onclick = () => window.openAvatarLightbox(user.avatarUrl, displayName);
  }

  if (statusEl) {
    statusEl.textContent = user.isOnline ? 'Online' : 'Offline';
    statusEl.className = `status-pill ${user.isOnline ? 'online' : 'offline'}`;
  }

  const userPosts = postsList.filter(p => p.uid === uid);
  if (postCountEl) postCountEl.textContent = userPosts.length;

  if (actionsEl && currentUser) {
    if (currentUser.uid !== uid) {
      const isFriend = friendsList.includes(uid);
      const isSent = sentRequests.includes(uid);
      const pendingReq = pendingRequests.find(req => req.uid === uid);

      let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
      if (isFriend) {
        actionBtn = `<button class="chat-btn" onclick="removeFriend('${uid}')"><i class="fa-solid fa-user-minus"></i> Unfriend</button>`;
      } else if (pendingReq) {
        actionBtn = `<button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${uid}', '${escapeHTML(pendingReq.fromName)}')"><i class="fa-solid fa-user-check"></i> Accept Request</button>`;
      } else if (isSent) {
        actionBtn = `<button class="chat-btn" disabled style="opacity: 0.6;"><i class="fa-solid fa-clock"></i> Request Sent</button>`;
      }

      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="openChatFromTab('${uid}', '${escapeHTML(displayName)}')"><i class="fa-solid fa-comment"></i> Send Message</button>
        ${actionBtn}
      `;
    } else {
      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="document.getElementById('profileModal').classList.add('hidden'); switchTab('settings');"><i class="fa-solid fa-camera"></i> Change Custom Picture</button>
      `;
    }
  }

  modalCurrentUid = uid;
  modalPostsLimit = 5;
  renderModalUserPosts();

  if (modal) modal.classList.remove('hidden');
};

window.startCall = function(isVideo) {
  const modal = document.getElementById('callModal');
  const statusText = document.getElementById('callStatusText');
  const userNameText = document.getElementById('callUserName');
  const videoPreview = document.getElementById('callVideoPreview');
  const localVideo = document.getElementById('localVideo');
  const avatarEl = document.getElementById('callAvatar');

  if (!modal) return;
  modal.classList.remove('hidden');
  
  const recipientName = activeChatRecipientName || 'User';
  if (userNameText) userNameText.textContent = recipientName;
  if (avatarEl) avatarEl.textContent = getInitials(recipientName);

  if (statusText) statusText.textContent = isVideo ? 'Connecting Video Call...' : 'Connecting Voice Call...';

  if (isVideo && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        currentCallStream = stream;
        if (videoPreview) videoPreview.classList.remove('hidden');
        if (localVideo) localVideo.srcObject = stream;
        if (statusText) statusText.textContent = 'Call Connected';
      })
      .catch(err => {
        console.warn("Media device camera access error:", err);
        if (statusText) statusText.textContent = 'Active Call (Audio Only)';
      });
  } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        currentCallStream = stream;
        if (statusText) statusText.textContent = 'Voice Call Connected';
      })
      .catch(() => {
        if (statusText) statusText.textContent = 'Active Call';
      });
  }
};

window.endCall = function() {
  const modal = document.getElementById('callModal');
  if (currentCallStream) {
    currentCallStream.getTracks().forEach(track => track.stop());
    currentCallStream = null;
  }
  if (modal) modal.classList.add('hidden');
  const videoPreview = document.getElementById('callVideoPreview');
  if (videoPreview) videoPreview.classList.add('hidden');
  showToast('Call ended.');
};

window.sendFriendRequest = async function(targetUid) {
  if (!currentUser) return;
  try {
    await set(ref(database, `friendRequests/${targetUid}/${currentUser.uid}`), {
      fromName: currentUser.name,
      timestamp: Date.now()
    });
    await set(ref(database, `sentRequests/${currentUser.uid}/${targetUid}`), true);
    sendNotification(targetUid, currentUser.name, 'sent you a friend request.', 'fa-user-plus');
    showToast('Friend request sent!');
    if (modalCurrentUid === targetUid) window.openUserProfile(targetUid);
  } catch (err) {
    console.error("Failed to send friend request:", err);
  }
};

window.acceptFriendRequest = async function(senderUid, senderName) {
  if (!currentUser) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${senderUid}`] = true;
    updates[`friends/${senderUid}/${currentUser.uid}`] = true;
    updates[`friendRequests/${currentUser.uid}/${senderUid}`] = null;
    updates[`sentRequests/${senderUid}/${currentUser.uid}`] = null;
    
    await update(ref(database), updates);
    sendNotification(senderUid, currentUser.name, 'accepted your friend request.', 'fa-user-check');
    showToast(`You are now friends with ${senderName}`);
    if (modalCurrentUid === senderUid) window.openUserProfile(senderUid);
  } catch (err) {
    console.error("Failed to accept request:", err);
  }
};

window.removeFriend = async function(friendUid) {
  if (!currentUser || !confirm('Are you sure you want to remove this friend?')) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${friendUid}`] = null;
    updates[`friends/${friendUid}/${currentUser.uid}`] = null;
    await update(ref(database), updates);
    showToast('Friend removed.');
    if (modalCurrentUid === friendUid) window.openUserProfile(friendUid);
  } catch (err) {
    console.error("Failed to remove friend:", err);
  }
};

window.toggleLike = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
      const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
      const likeSnap = await get(likeRef);

      if (likeSnap.exists()) {
        await remove(likeRef);
      } else {
        await set(likeRef, true);
        await remove(dislikeRef);
        if (post.uid && post.uid !== currentUser.uid) {
          sendNotification(post.uid, currentUser.name, 'liked your post.', 'fa-heart');
        }
      }
    }
  } catch (err) {
    console.error("Failed to toggle like:", err);
  }
};

window.toggleDislike = async function(id) {
  if (!currentUser) return;
  try {
    const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const snapshot = await get(dislikeRef);

    if (snapshot.exists()) {
      await remove(dislikeRef);
    } else {
      await set(dislikeRef, true);
      await remove(likeRef);
    }
  } catch (err) {
    console.error("Failed to toggle dislike:", err);
  }
};

window.toggleCommentSection = function(id) {
  const section = document.getElementById(`commentSection-${id}`);
  if (section) section.classList.toggle('hidden');
};

window.addComment = async function(id) {
  const input = document.getElementById(`commentInput-${id}`);
  if (!input || !input.value.trim()) return;

  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const commentsRef = ref(database, `posts/${id}/comments`);
      
      await push(commentsRef, {
        author: currentUser ? currentUser.name : 'Anonymous',
        uid: currentUser ? currentUser.uid : null,
        authorAvatarUrl: currentUser ? currentUser.avatarUrl : null,
        text: input.value.trim(),
        createdAt: Date.now()
      });

      if (post.uid && currentUser && post.uid !== currentUser.uid) {
        sendNotification(post.uid, currentUser.name, 'commented on your post.', 'fa-comment');
      }
    }
    input.value = '';
  } catch (err) {
    console.error("Failed to add comment:", err);
  }
};

window.toggleEditPost = function(id) {
  const displayEl = document.getElementById(`postContent-${id}`);
  const editContainer = document.getElementById(`editPostContainer-${id}`);
  if (displayEl && editContainer) {
    displayEl.classList.toggle('hidden');
    editContainer.classList.toggle('hidden');
  }
};

window.saveEditPost = async function(id) {
  const textarea = document.getElementById(`editPostInput-${id}`);
  if (!textarea) return;
  const newContent = textarea.value.trim();
  if (!newContent) {
    showToast("Post content cannot be empty.");
    return;
  }

  try {
    await update(ref(database, `posts/${id}`), {
      content: newContent,
      editedAt: Date.now(),
      isEdited: true
    });
    showToast("Post updated successfully!");
  } catch (err) {
    console.error("Failed to update post:", err);
    showToast("Failed to save changes.");
  }
};

window.deletePost = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);
    if (snapshot.exists()) {
      const post = snapshot.val();
      if (post.uid === currentUser.uid || post.authorEmail === currentUser.email) {
        if (confirm('Are you sure you want to delete this post?')) {
          await remove(postRef);
          showToast('Post deleted successfully.');
        }
      } else {
        showToast('Unauthorized: You can only delete your own posts.');
      }
    }
  } catch (err) {
    console.error("Failed to delete post:", err);
  }
};

window.openChat = function(recipientUid, recipientName) {
  if (!currentUser) {
    showToast('Please log in to chat.');
    return;
  }

  const chatPopup = document.getElementById('chatPopup');
  const chatFriendName = document.getElementById('chatFriendName');
  const chatMessages = document.getElementById('chatMessages');
  const typingIndicator = document.getElementById('typing-indicator');

  if (!chatPopup) return;

  activeChatRecipientUid = recipientUid;
  activeChatRecipientName = recipientName || 'User';

  chatFriendName.textContent = `Chat with ${activeChatRecipientName}`;
  chatPopup.classList.remove('hidden');

  const roomPath = recipientUid ? [currentUser.uid, recipientUid].sort().join('_') : 'global_room';
  activeChatRoom = `direct_${roomPath}`;

  if (activeChatRef && activeChatCallback) {
    off(activeChatRef, 'value', activeChatCallback);
  }
  if (activeTypingListenerRef && activeTypingListenerCallback) {
    off(activeTypingListenerRef, 'value', activeTypingListenerCallback);
  }

  chatMessages.innerHTML = `<div class="chat-msg system">Connecting to conversation...</div>`;

  activeTypingListenerRef = ref(database, `typing/${activeChatRoom}`);
  activeTypingListenerCallback = (snap) => {
    if (!typingIndicator) return;
    const data = snap.val() || {};
    const isSomeoneElseTyping = Object.keys(data).some(uid => uid !== currentUser.uid && data[uid] === true);
    typingIndicator.style.display = isSomeoneElseTyping ? 'flex' : 'none';
  };
  onValue(activeTypingListenerRef, activeTypingListenerCallback);

  activeChatRef = ref(database, `chats/${activeChatRoom}`);
  activeChatCallback = (snapshot) => {
    const data = snapshot.val();
    chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(activeChatRecipientName)}</div>`;
    if (data) {
      let hasUnread = false;
      Object.entries(data).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) {
          hasUnread = true;
        }

        const msgEl = document.createElement('div');
        const isMe = msg.senderUid === currentUser.uid;
        msgEl.className = isMe ? 'chat-msg outgoing' : 'chat-msg incoming';
        
        let html = `<div>${escapeHTML(msg.text || '')}`;
        if (isMe) {
          html += ` <span class="read-receipt" data-message-id="${msgId}"><i class="fa-solid fa-check-double ${msg.read ? 'text-blue-500' : ''}"></i></span>`;
        }
        html += `</div>`;
        
        if (msg.attachment) {
          const isImg = (msg.attachmentType === 'image') || msg.attachment.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i);
          if (isImg) {
            html += `<div style="margin-top: 5px;"><img src="${escapeHTML(msg.attachment)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; display: block;" /></div>`;
          } else {
            html += `
              <div style="margin-top: 5px; background: rgba(0,0,0,0.1); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                <a href="${escapeHTML(msg.attachment)}" target="_blank" download style="color: inherit; font-weight: bold; text-decoration: underline; display: flex; align-items: center; gap: 6px;">
                  <i class="fa-solid fa-file-arrow-down"></i> ${escapeHTML(msg.attachmentName || 'Download Attachment')}
                </a>
              </div>`;
          }
        }
        msgEl.innerHTML = html;
        chatMessages.appendChild(msgEl);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (hasUnread) {
        window.markMessagesRead(activeChatRoom);
      }
    }
  };

  onValue(activeChatRef, activeChatCallback);
};

window.openChatFromTab = function(friendUid, friendName) {
  document.getElementById('profileModal')?.classList.add('hidden');
  window.openChat(friendUid, friendName);
};

window.switchTab = function(tabName) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabViews = document.querySelectorAll('.tab-view');
  
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  tabViews.forEach(view => {
    if (view.id === `${tabName}View`) view.classList.remove('hidden');
    else view.classList.add('hidden');
  });
};

// 6. INITIALIZATION & CONTROLLERS
document.addEventListener('DOMContentLoaded', () => {

  const themeToggleBtns = document.querySelectorAll('.themeToggleBtn');
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.body.classList.add('dark-theme');
    themeToggleBtns.forEach(btn => btn.innerHTML = '<i class="fa-solid fa-sun"></i> Light Mode');
  }

  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggleBtns.forEach(b => {
        b.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
      });
    });
  });

  let isSignUpMode = false;

  const elements = {
    authScreen: document.getElementById('authScreen'),
    appContent: document.getElementById('appContent'),
    authPageForm: document.getElementById('authPageForm'),
    tabLoginBtn: document.getElementById('tabLoginBtn'),
    tabSignupBtn: document.getElementById('tabSignupBtn'),
    fullNameGroup: document.getElementById('fullNameGroup'),
    phoneGroup: document.getElementById('phoneGroup'),
    districtGroup: document.getElementById('districtGroup'),
    villageGroup: document.getElementById('villageGroup'),
    pageAuthName: document.getElementById('pageAuthName'),
    pageAuthPhone: document.getElementById('pageAuthPhone'),
    pageAuthDistrict: document.getElementById('pageAuthDistrict'),
    pageAuthVillage: document.getElementById('pageAuthVillage'),
    pageAuthEmail: document.getElementById('pageAuthEmail'),
    pageAuthPassword: document.getElementById('pageAuthPassword'),
    pageAuthSubmitBtn: document.getElementById('pageAuthSubmitBtn'),
    authErrorMsg: document.getElementById('authErrorMsg'),
    forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),
    forgotPasswordWrapper: document.getElementById('forgotPasswordWrapper'),
    authSwitchPrompt: document.getElementById('authSwitchPrompt'),

    navDrawer: document.getElementById('navDrawer'),
    drawerOverlay: document.getElementById('drawerOverlay'),
    navBtns: document.querySelectorAll('.nav-btn'),
    drawerCloseBtn: document.getElementById('drawerCloseBtn'),
    
    profileNames: document.querySelectorAll('.profile-name'),
    profileEmails: document.querySelectorAll('.profile-email'),
    profileAvatars: document.querySelectorAll('.profile-avatar'),
    
    logoutBtns: document.querySelectorAll('.logout-btn'),
    signupBtn: document.querySelector('.signup-btn'),
    searchInput: document.getElementById('searchInput'),
    searchActionBtn: document.getElementById('searchActionBtn'),

    postText: document.getElementById('postText'),
    postPhotoInput: document.getElementById('postPhotoInput'),
    postFileInput: document.getElementById('postFileInput'),
    postBtn: document.getElementById('createPostSubmitBtn'),
    postBox: document.getElementById('postBox'),
    feedContainer: document.getElementById('feedContainer'),
    loadMorePostsBtn: document.getElementById('loadMorePostsBtn'),
    
    fabBtn: document.getElementById('fabBtn'),
    fabOptions: document.getElementById('fabOptions'),
    fabChatBtn: document.getElementById('fabChatBtn'),
    fabCreatePostBtn: document.getElementById('fabCreatePostBtn'),
    fabContainer: document.getElementById('fabContainer'),

    backToTopBtn: document.getElementById('backToTopBtn'),
    toastNotice: document.getElementById('toastNotice'),
    toastClose: document.getElementById('toastCloseBtn'),

    chatPopup: document.getElementById('chatPopup'),
    chatFriendName: document.getElementById('chatFriendName'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatFileInput: document.getElementById('chatFileInput'),
    chatSendBtn: document.getElementById('chatSendBtn'),
    chatCloseBtn: document.getElementById('chatCloseBtn'),
    
    voiceCallTrigger: document.getElementById('voiceCallTrigger'),
    videoCallTrigger: document.getElementById('videoCallTrigger'),

    tabBtns: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
  };

  function init() {
    setupPreviewContainers();
    bindEvents();
    listenToAuthState();
    listenToPosts();
    listenToUsers();
    window.switchTab('posts');
  }

  function updateAuthView(isLoggedIn) {
    if (isLoggedIn) {
      if (elements.authScreen) elements.authScreen.classList.add('hidden');
      if (elements.appContent) elements.appContent.classList.remove('hidden');
      
      const displayName = currentUser.name || 'Member';
      elements.profileNames.forEach(el => el.textContent = displayName);
      elements.profileEmails.forEach(el => el.textContent = currentUser.email || '');
      elements.profileAvatars.forEach(el => applyAvatarStyle(el, currentUser.avatarUrl, displayName));
      
      const topBarUserProfile = document.getElementById('topBarUserProfile');
      if (topBarUserProfile) topBarUserProfile.classList.remove('hidden');
      if (elements.signupBtn) elements.signupBtn.classList.add('hidden');

      const settingsNameInput = document.getElementById('settingsNameInput');
      const settingsEmailInput = document.getElementById('settingsEmailInput');
      const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');

      if (settingsNameInput) settingsNameInput.value = displayName;
      if (settingsEmailInput) settingsEmailInput.value = currentUser.email || '';
      if (settingsAvatarPreview) applyAvatarStyle(settingsAvatarPreview, currentUser.avatarUrl, displayName);
    } else {
      if (elements.authScreen) elements.authScreen.classList.remove('hidden');
      if (elements.appContent) elements.appContent.classList.add('hidden');
      const topBarUserProfile = document.getElementById('topBarUserProfile');
      if (topBarUserProfile) topBarUserProfile.classList.add('hidden');
      if (elements.signupBtn) elements.signupBtn.classList.remove('hidden');
    }
  }

  function setAuthMode(signUp) {
    isSignUpMode = signUp;
    elements.tabLoginBtn.classList.toggle('active', !isSignUpMode);
    elements.tabSignupBtn.classList.toggle('active', isSignUpMode);
    
    elements.fullNameGroup.classList.toggle('hidden', !isSignUpMode);
    elements.phoneGroup.classList.toggle('hidden', !isSignUpMode);
    elements.districtGroup.classList.toggle('hidden', !isSignUpMode);
    elements.villageGroup.classList.toggle('hidden', !isSignUpMode);
    
    if (elements.forgotPasswordWrapper) {
      elements.forgotPasswordWrapper.style.display = isSignUpMode ? 'none' : 'block';
    }

    elements.pageAuthSubmitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Log In';
    elements.authSwitchPrompt.innerHTML = isSignUpMode
      ? `Already have an account? <a href="#" id="authRedirectBtn" style="color: var(--color-red); font-weight: bold; text-decoration: underline;">Log In</a>`
      : `Don't have an account? <a href="#" id="authRedirectBtn" style="color: var(--color-red); font-weight: bold; text-decoration: underline;">Sign Up</a>`;

    document.getElementById('authRedirectBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode(!isSignUpMode);
    });

    if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';
  }

  function bindEvents() {
    elements.tabLoginBtn?.addEventListener('click', () => setAuthMode(false));
    elements.tabSignupBtn?.addEventListener('click', () => setAuthMode(true));

    document.getElementById('authRedirectBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode(!isSignUpMode);
    });

    elements.forgotPasswordBtn?.addEventListener('click', async () => {
      const email = elements.pageAuthEmail.value.trim();
      if (!email) {
        if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Please enter your email address to reset password.';
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset link sent to your email.');
        if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';
      } catch (err) {
        if (elements.authErrorMsg) elements.authErrorMsg.textContent = err.message;
      }
    });

    elements.authPageForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';

      const email = elements.pageAuthEmail.value.trim();
      const password = elements.pageAuthPassword.value;

      try {
        if (isSignUpMode) {
          const name = elements.pageAuthName.value.trim();
          const phone = elements.pageAuthPhone.value.trim();
          const district = elements.pageAuthDistrict.value.trim();
          const village = elements.pageAuthVillage.value.trim();

          if (!name) throw new Error('Full Name is required.');

          const userCred = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(userCred.user, { displayName: name });

          await set(ref(database, `users/${userCred.user.uid}`), {
            displayName: name,
            email: email,
            phone: phone,
            district: district,
            village: village,
            createdAt: Date.now(),
            isOnline: true
          });

          showToast('Account created successfully!');
        } else {
          await signInWithEmailAndPassword(auth, email, password);
          showToast('Welcome back!');
        }
      } catch (err) {
        if (elements.authErrorMsg) elements.authErrorMsg.textContent = err.message;
      }
    });

    elements.navBtns.forEach(btn => btn.addEventListener('click', () => {
      elements.navDrawer?.classList.add('open');
      elements.drawerOverlay?.classList.add('active');
    }));

    elements.drawerCloseBtn?.addEventListener('click', closeDrawer);
    elements.drawerOverlay?.addEventListener('click', closeDrawer);

    elements.logoutBtns.forEach(btn => btn.addEventListener('click', () => {
      if (currentUser) {
        set(ref(database, `users/${currentUser.uid}/isOnline`), false);
      }
      signOut(auth).then(() => showToast('Logged out.'));
      closeDrawer();
    }));

    elements.signupBtn?.addEventListener('click', () => {
      setAuthMode(false);
      updateAuthView(false);
    });

    elements.searchInput?.addEventListener('input', (e) => {
      renderFeed(e.target.value.trim());
    });

    elements.searchActionBtn?.addEventListener('click', () => {
      renderFeed(getCurrentSearchQuery());
    });

    elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        window.switchTab(btn.dataset.tab);
      });
    });

    document.querySelectorAll('.nav-link-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = link.dataset.tab;
        if (tab) {
          window.switchTab(tab);
          closeDrawer();
        }
      });
    });

    elements.postPhotoInput?.addEventListener('change', (e) => handlePostFileSelect(e.target.files[0]));
    elements.postFileInput?.addEventListener('change', (e) => handlePostFileSelect(e.target.files[0]));

    elements.postBtn?.addEventListener('click', handleCreatePost);

    elements.loadMorePostsBtn?.addEventListener('click', () => {
      postsLimit += 25;
      listenToPosts();
    });

    // FLOATING PLUS BUTTON & POPUP MENU REDIRECT EVENTS
    elements.fabBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.fabOptions?.classList.toggle('hidden');
      elements.fabBtn?.classList.toggle('active');
    });

    elements.fabChatBtn?.addEventListener('click', () => {
      elements.fabOptions?.classList.add('hidden');
      elements.fabBtn?.classList.remove('active');
      window.switchTab('chats');
    });

    elements.fabCreatePostBtn?.addEventListener('click', () => {
      elements.fabOptions?.classList.add('hidden');
      elements.fabBtn?.classList.remove('active');
      window.switchTab('posts');
      const postBox = document.getElementById('postBox');
      const postText = document.getElementById('postText');
      if (postBox) postBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (postText) postText.focus();
    });

    document.addEventListener('click', (e) => {
      if (elements.fabContainer && !elements.fabContainer.contains(e.target)) {
        elements.fabOptions?.classList.add('hidden');
        elements.fabBtn?.classList.remove('active');
      }
    });

    elements.backToTopBtn?.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) elements.backToTopBtn?.classList.remove('hidden');
      else elements.backToTopBtn?.classList.add('hidden');
    });

    elements.chatSendBtn?.addEventListener('click', handleSendChatMessage);
    elements.chatInput?.addEventListener('keypress', (e) => {
      window.triggerTypingStatus();
      if (e.key === 'Enter') handleSendChatMessage();
    });

    elements.chatInput?.addEventListener('focus', (e) => lastFocusedInput = e.target);
    elements.postText?.addEventListener('focus', (e) => lastFocusedInput = e.target);

    elements.chatFileInput?.addEventListener('change', (e) => handleChatFileSelect(e.target.files[0]));

    elements.chatCloseBtn?.addEventListener('click', () => {
      elements.chatPopup?.classList.add('hidden');
    });

    elements.voiceCallTrigger?.addEventListener('click', () => window.startCall(false));
    elements.videoCallTrigger?.addEventListener('click', () => window.startCall(true));

    document.getElementById('callEndBtn')?.addEventListener('click', window.endCall);

    document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
      document.getElementById('profileModal')?.classList.add('hidden');
    });

    document.getElementById('closeLightboxModalBtn')?.addEventListener('click', () => {
      document.getElementById('avatarLightboxModal')?.classList.add('hidden');
    });

    document.getElementById('drawerProfileInfo')?.addEventListener('click', () => {
      if (currentUser) {
        window.openUserProfile(currentUser.uid);
        closeDrawer();
      }
    });

    document.getElementById('topBarUserProfile')?.addEventListener('click', () => {
      if (currentUser) window.openUserProfile(currentUser.uid);
    });

    document.getElementById('markAllReadBtn')?.addEventListener('click', markAllNotificationsRead);

    document.getElementById('profilePicInput')?.addEventListener('change', handleProfilePicUpload);

    document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('settingsNameInput');
      if (!nameInput || !currentUser) return;
      const newName = nameInput.value.trim();
      if (!newName) {
        showToast('Name cannot be empty.');
        return;
      }
      try {
        await updateProfile(auth.currentUser, { displayName: newName });
        await update(ref(database, `users/${currentUser.uid}`), { displayName: newName });
        currentUser.name = newName;
        updateAuthView(true);
        showToast('Settings saved successfully.');
      } catch (err) {
        console.error("Save settings failed:", err);
        showToast('Failed to save settings.');
      }
    });

    document.getElementById('enablePushBtn')?.addEventListener('click', () => {
      if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
          if (permission === "granted") showToast('Browser desktop alerts enabled!');
          else showToast('Alerts permission denied.');
        });
      } else {
        showToast('Desktop alerts not supported in this browser.');
      }
    });

    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('emoji-picker-dropdown');
      if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.emoji-trigger-btn')) {
        dropdown.classList.add('hidden');
      }
    });
  }

  function handlePostFileSelect(file) {
    if (!file) return;
    currentPostFile = file;

    const previewContainer = document.getElementById('postPreviewContainer');
    const previewImg = document.getElementById('postPreviewImg');
    const previewVid = document.getElementById('postPreviewVid');
    const previewAud = document.getElementById('postPreviewAud');
    const previewFile = document.getElementById('postPreviewFile');

    if (!previewContainer) return;

    previewImg.style.display = 'none';
    previewVid.style.display = 'none';
    previewAud.style.display = 'none';
    previewFile.style.display = 'none';

    const url = URL.createObjectURL(file);

    if (file.type.startsWith('image/')) {
      previewImg.src = url;
      previewImg.style.display = 'block';
    } else if (file.type.startsWith('video/')) {
      previewVid.src = url;
      previewVid.style.display = 'block';
    } else if (file.type.startsWith('audio/')) {
      previewAud.src = url;
      previewAud.style.display = 'block';
    } else {
      previewFile.textContent = `Attached: ${file.name}`;
      previewFile.style.display = 'block';
    }

    previewContainer.style.display = 'block';
  }

  function handleChatFileSelect(file) {
    if (!file) return;
    currentChatFile = file;
    const chatPreviewContainer = document.getElementById('chatPreviewContainer');
    const chatPreviewText = document.getElementById('chatPreviewText');
    if (chatPreviewContainer && chatPreviewText) {
      chatPreviewText.textContent = `Attachment: ${file.name}`;
      chatPreviewContainer.style.display = 'flex';
    }
  }

  async function handleCreatePost() {
    if (!currentUser) {
      showToast("Please log in to publish posts.");
      return;
    }

    const content = elements.postText ? elements.postText.value.trim() : '';
    if (!content && !currentPostFile) {
      showToast("Please enter message content or attach a file.");
      return;
    }

    if (elements.postBtn) elements.postBtn.disabled = true;

    try {
      let mediaUrl = null;
      let mediaType = null;

      if (currentPostFile) {
        mediaUrl = await uploadMediaFile(currentPostFile, 'post_attachments');
        if (currentPostFile.type.startsWith('image/')) mediaType = 'image';
        else if (currentPostFile.type.startsWith('video/')) mediaType = 'video';
        else if (currentPostFile.type.startsWith('audio/')) mediaType = 'audio';
        else mediaType = 'file';
      }

      const newPostRef = push(ref(database, 'posts'));
      await set(newPostRef, {
        author: currentUser.name,
        authorEmail: currentUser.email,
        authorAvatarUrl: currentUser.avatarUrl || null,
        uid: currentUser.uid,
        content: content,
        attachment: mediaUrl,
        attachmentType: mediaType,
        attachmentName: currentPostFile ? currentPostFile.name : null,
        createdAt: Date.now()
      });

      if (elements.postText) elements.postText.value = '';
      clearPostPreview();
      showToast("Post published successfully!");
    } catch (err) {
      console.error("Create post error:", err);
      showToast("Failed to create post.");
    } finally {
      if (elements.postBtn) elements.postBtn.disabled = false;
    }
  }

  async function handleSendChatMessage() {
    if (!currentUser || !activeChatRoom) return;
    const text = elements.chatInput ? elements.chatInput.value.trim() : '';

    if (!text && !currentChatFile) return;

    try {
      let attachmentUrl = null;
      let attachmentType = null;

      if (currentChatFile) {
        attachmentUrl = await uploadMediaFile(currentChatFile, 'chat_attachments');
        if (currentChatFile.type.startsWith('image/')) attachmentType = 'image';
        else attachmentType = 'file';
      }

      const msgRef = push(ref(database, `chats/${activeChatRoom}`));
      await set(msgRef, {
        senderUid: currentUser.uid,
        senderName: currentUser.name,
        text: text,
        attachment: attachmentUrl,
        attachmentType: attachmentType,
        attachmentName: currentChatFile ? currentChatFile.name : null,
        createdAt: Date.now(),
        read: false
      });

      if (elements.chatInput) elements.chatInput.value = '';
      clearChatPreview();

      if (activeChatRecipientUid) {
        sendNotification(activeChatRecipientUid, currentUser.name, 'sent you a message.', 'fa-comment');
      }

      set(ref(database, `typing/${activeChatRoom}/${currentUser.uid}`), false);
    } catch (err) {
      console.error("Failed to send chat message:", err);
    }
  }

  async function handleProfilePicUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentUser) return;

    try {
      showToast('Uploading profile picture...');
      const downloadUrl = await uploadMediaFile(file, `profile_pictures/${currentUser.uid}`);
      if (downloadUrl) {
        await updateProfile(auth.currentUser, { photoURL: downloadUrl });
        await update(ref(database, `users/${currentUser.uid}`), { avatarUrl: downloadUrl });
        currentUser.avatarUrl = downloadUrl;
        updateAuthView(true);
        showToast('Profile picture updated successfully!');
      }
    } catch (err) {
      console.error("Profile picture upload error:", err);
      showToast('Failed to upload picture.');
    }
  }

  function listenToAuthState() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        let userData = {};
        try {
          const userSnapshot = await get(ref(database, `users/${user.uid}`));
          if (userSnapshot.exists()) {
            userData = userSnapshot.val();
          }
        } catch (err) {
          console.warn("Could not load user profile data:", err);
        }

        currentUser = {
          uid: user.uid,
          name: userData.displayName || user.displayName || user.email.split('@')[0],
          email: user.email,
          avatarUrl: userData.avatarUrl || user.photoURL || null
        };
        
        setupPresenceSystem(user);
        updateAuthView(true);
        listenToNotifications();
        listenToUserSocialData();
      } else {
        currentUser = null;
        detachUserListeners();
        updateAuthView(false);
      }
    });
  }

  function listenToUserSocialData() {
    if (!currentUser) return;

    if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
    friendsRef = ref(database, `friends/${currentUser.uid}`);
    friendsCallback = (snap) => {
      friendsList = snap.exists() ? Object.keys(snap.val()) : [];
      renderUsersList();
    };
    onValue(friendsRef, friendsCallback);

    if (bookmarksRef && bookmarksCallback) off(bookmarksRef, 'value', bookmarksCallback);
    bookmarksRef = ref(database, `users/${currentUser.uid}/bookmarks`);
    bookmarksCallback = (snap) => {
      userBookmarks = snap.exists() ? snap.val() : {};
      renderFeed(getCurrentSearchQuery());
    };
    onValue(bookmarksRef, bookmarksCallback);

    if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
    requestsRef = ref(database, `friendRequests/${currentUser.uid}`);
    requestsCallback = (snap) => {
      pendingRequests = [];
      if (snap.exists()) {
        Object.keys(snap.val()).forEach(uid => {
          pendingRequests.push({ uid, ...snap.val()[uid] });
        });
      }
      renderUsersList();
    };
    onValue(requestsRef, requestsCallback);

    if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
    sentRequestsRef = ref(database, `sentRequests/${currentUser.uid}`);
    sentRequestsCallback = (snap) => {
      sentRequests = snap.exists() ? Object.keys(snap.val()) : [];
      renderUsersList();
    };
    onValue(sentRequestsRef, sentRequestsCallback);
  }

  function listenToUsers() {
    const usersQuery = query(ref(database, 'users'), limitToLast(100));

    onValue(usersQuery, (snapshot) => {
      const data = snapshot.val();
      usersList = [];
      if (data) {
        Object.keys(data).forEach(uid => {
          usersList.push({ uid, ...data[uid] });
        });
      }
      renderUsersList();
    });
  }

  function renderUsersList() {
    const chatsContainer = document.getElementById('chatsListContainer');
    const findFriendsContainer = document.getElementById('friendsListContainer');
    const sidebarContainer = document.getElementById('sidebarMembersContainer');

    const otherMembers = usersList.filter(u => !currentUser || u.uid !== currentUser.uid);
    const loggedAndAddedFriends = otherMembers.filter(u => u.isOnline || friendsList.includes(u.uid));

    if (chatsContainer) {
      chatsContainer.innerHTML = loggedAndAddedFriends.length === 0 ? '<p style="color:#888; font-size:13px; padding:10px;">No logged-in or added friends available.</p>' : loggedAndAddedFriends.map(u => {
        const isFriend = friendsList.includes(u.uid);
        return `
        <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${u.uid}')">
            <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
              <div class="avatar" style="${u.avatarUrl ? `background-image: url('${u.avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${u.avatarUrl ? '' : getInitials(u.displayName)}</div>
              <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
            </div>
            <div>
              <strong style="font-size: 14px; display: block;">${escapeHTML(u.displayName || 'Member')} ${isFriend ? '<span style="font-size: 10px; color: var(--color-red); font-weight: normal;">(Friend)</span>' : ''}</strong>
              <span style="font-size: 11px; opacity: 0.7;">${u.isOnline ? 'Online now' : 'Offline'}</span>
            </div>
          </div>
          <button class="chat-btn" onclick="openChatFromTab('${u.uid}', '${escapeHTML(u.displayName || 'Member')}')"><i class="fa-solid fa-comment"></i> Chat</button>
        </div>
      `;
      }).join('');
    }

    if (findFriendsContainer) {
      let html = '';

      if (pendingRequests.length > 0) {
        html += `<h4 style="margin: 10px 0 5px; font-size: 13px; color: var(--color-red);">Pending Requests</h4>`;
        html += pendingRequests.map(req => `
          <div class="friend-item" style="margin-bottom: 10px; padding: 8px; background: rgba(0,0,0,0.02); border-radius: 6px;">
            <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${req.uid}')">
              <div class="avatar">${getInitials(req.fromName)}</div>
              <div><strong>${escapeHTML(req.fromName)}</strong></div>
            </div>
            <button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${req.uid}', '${escapeHTML(req.fromName)}')"><i class="fa-solid fa-user-check"></i> Accept</button>
          </div>
        `).join('');
      }

      html += `<h4 style="margin: 15px 0 5px; font-size: 13px; color: #888;">Find Friends Network</h4>`;
      html += otherMembers.length === 0 ? '<p style="color:#888; font-size:13px; padding:10px;">No other members to display.</p>' : otherMembers.map(u => {
        const isFriend = friendsList.includes(u.uid);
        const isSent = sentRequests.includes(u.uid);

        let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${u.uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
        if (isFriend) {
          actionBtn = `<button class="chat-btn" style="opacity: 0.7;" onclick="removeFriend('${u.uid}')"><i class="fa-solid fa-user-minus"></i> Remove</button>`;
        } else if (isSent) {
          actionBtn = `<button class="chat-btn" disabled style="opacity: 0.5;"><i class="fa-solid fa-clock"></i> Pending</button>`;
        }

        return `
          <div class="friend-item" style="margin-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 8px;">
            <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${u.uid}')">
              <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
                <div class="avatar" style="${u.avatarUrl ? `background-image: url('${u.avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${u.avatarUrl ? '' : getInitials(u.displayName)}</div>
                <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
              </div>
              <div>
                <strong>${escapeHTML(u.displayName || 'Member')}</strong>
                <span style="display: block; font-size: 11px; opacity: 0.6;">${escapeHTML(u.email || 'Soroti Youth Forum')}</span>
              </div>
            </div>
            ${actionBtn}
          </div>
        `;
      }).join('');

      findFriendsContainer.innerHTML = html;
    }

    if (sidebarContainer) {
      sidebarContainer.innerHTML = loggedAndAddedFriends.length === 0 ? '<p style="color:#888; font-size:12px;">No logged or added friends active right now.</p>' : loggedAndAddedFriends.slice(0, 8).map(u => `
        <div class="friend-item" style="margin-bottom: 8px;">
          <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${u.uid}')">
            <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
              <div class="avatar" style="${u.avatarUrl ? `background-image: url('${u.avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${u.avatarUrl ? '' : getInitials(u.displayName)}</div>
              <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
            </div>
            <span style="font-size: 13px; font-weight: 500;">${escapeHTML(u.displayName || 'Member')}</span>
          </div>
          <button class="chat-btn" style="padding: 4px 8px; font-size: 11px;" onclick="openChatFromTab('${u.uid}', '${escapeHTML(u.displayName || 'Member')}')"><i class="fa-solid fa-comment"></i></button>
        </div>
      `).join('');
    }
  }

  function listenToNotifications() {
    if (!currentUser) return;

    if (notifRef && notifCallback) off(notifRef, 'value', notifCallback);

    notifRef = ref(database, `notifications/${currentUser.uid}`);
    notifCallback = (snapshot) => {
      const data = snapshot.val();
      const notifContainer = document.getElementById('notificationsContainer');
      const badges = document.querySelectorAll('.notif-badge');

      if (!notifContainer) return;

      if (!data) {
        notifContainer.innerHTML = '<p style="color:#888; font-size:13px; text-align:center; padding:15px 0;">No notifications yet.</p>';
        badges.forEach(b => {
          b.textContent = '0';
          b.style.display = 'none';
        });
        return;
      }

      const notifList = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      notifList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const unreadCount = notifList.filter(n => !n.read).length;
      badges.forEach(b => {
        b.textContent = unreadCount;
        b.style.display = unreadCount > 0 ? 'inline-block' : 'none';
      });

      notifContainer.innerHTML = notifList.map(item => `
        <div style="padding: 10px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; background: ${item.read ? 'transparent' : 'var(--item-hover-bg)'}; border-radius: 6px; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fa-solid ${item.icon || 'fa-bell'}" style="color: var(--color-red); font-size: 16px;"></i>
            <div>
              <div style="font-size: 13px; font-weight: ${item.read ? 'normal' : 'bold'};"><strong>${escapeHTML(item.title || '')}</strong> ${escapeHTML(item.message || '')}</div>
              <span style="font-size: 10px; opacity: 0.6;">${item.createdAt ? timeAgo(item.createdAt) : (item.time || '')}</span>
            </div>
          </div>
          ${!item.read ? `<button onclick="markNotificationRead('${item.id}')" style="background:none; border:none; color:var(--color-red); cursor:pointer; font-size:12px;" title="Mark as Read"><i class="fa-solid fa-check"></i></button>` : ''}
        </div>
      `).join('');
    };

    onValue(notifRef, notifCallback);
  }

  window.markNotificationRead = async function(notifId) {
    if (!currentUser || !notifId) return;
    try {
      await update(ref(database, `notifications/${currentUser.uid}/${notifId}`), { read: true });
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  async function markAllNotificationsRead() {
    if (!currentUser) return;
    try {
      const userNotifRef = ref(database, `notifications/${currentUser.uid}`);
      const snap = await get(userNotifRef);
      if (snap.exists()) {
        const updates = {};
        Object.keys(snap.val()).forEach(id => {
          updates[`${id}/read`] = true;
        });
        await update(userNotifRef, updates);
        showToast("All notifications marked as read.");
      }
    } catch (err) {
      console.error("Failed to mark all read:", err);
    }
  }

  function listenToPosts() {
    if (currentPostsQueryRef) {
      off(currentPostsQueryRef);
    }

    currentPostsQueryRef = query(ref(database, 'posts'), limitToLast(postsLimit));

    onValue(currentPostsQueryRef, (snapshot) => {
      const data = snapshot.val();
      postsList = [];
      if (data) {
        Object.entries(data).forEach(([id, val]) => {
          postsList.push({ id, ...val });
        });
      }
      postsList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      renderFeed(getCurrentSearchQuery());
      if (modalCurrentUid) {
        renderModalUserPosts();
      }
    });
  }

  function renderFeed(filterText = '') {
    const feedContainer = document.getElementById('feedContainer');
    if (!feedContainer) return;

    let filtered = postsList;
    if (filterText) {
      const q = filterText.toLowerCase();
      filtered = postsList.filter(p => 
        (p.author && p.author.toLowerCase().includes(q)) ||
        (p.content && p.content.toLowerCase().includes(q)) ||
        (p.attachmentName && p.attachmentName.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      feedContainer.innerHTML = `<div class="card" style="text-align: center; color: #888; padding: 25px;"><i class="fa-solid fa-newspaper" style="font-size: 28px; margin-bottom: 8px; color: var(--color-red);"></i><p>No posts found${filterText ? ' matching your search' : ''}.</p></div>`;
      return;
    }

    feedContainer.innerHTML = filtered.map(post => {
      const isBookmarked = userBookmarks && userBookmarks[post.id];
      const likesCount = post.likes ? Object.keys(post.likes).length : 0;
      const dislikesCount = post.dislikes ? Object.keys(post.dislikes).length : 0;
      const isLiked = currentUser && post.likes && post.likes[currentUser.uid];
      const isDisliked = currentUser && post.dislikes && post.dislikes[currentUser.uid];
      const isOwner = currentUser && (post.uid === currentUser.uid || post.authorEmail === currentUser.email);
      const displayTime = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');

      let commentsListHTML = '';
      let commentCount = 0;
      if (post.comments) {
        const cArray = Object.entries(post.comments).map(([cid, cval]) => ({ cid, ...cval }));
        commentCount = cArray.length;
        commentsListHTML = cArray.map(c => `
          <div style="font-size: 12px; margin-bottom: 6px; padding: 6px 8px; background: var(--item-hover-bg); border-radius: 6px; display: flex; align-items: flex-start; gap: 8px;">
            <div class="avatar comment-avatar" style="${c.authorAvatarUrl ? `background-image: url('${c.authorAvatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${c.authorAvatarUrl ? '' : getInitials(c.author)}</div>
            <div style="flex: 1;">
              <strong style="cursor: pointer;" onclick="openUserProfile('${c.uid}')">${escapeHTML(c.author || 'Anonymous')}</strong>
              <span style="display: block; font-size: 11px; opacity: 0.9;">${escapeHTML(c.text || '')}</span>
            </div>
          </div>
        `).join('');
      }

      let attachmentHTML = '';
      if (post.attachment) {
        const type = post.attachmentType || '';
        if (type === 'image') {
          attachmentHTML = `<div class="media-attachment-container"><img src="${escapeHTML(post.attachment)}" style="width: 100%; max-height: 450px; object-fit: contain; display: block;" /></div>`;
        } else if (type === 'video') {
          attachmentHTML = `<div class="media-attachment-container"><video src="${escapeHTML(post.attachment)}" controls style="width: 100%; max-height: 400px; display: block;"></video></div>`;
        } else if (type === 'audio') {
          attachmentHTML = `<div class="media-attachment-container" style="padding: 10px; background: var(--card-bg);"><audio src="${escapeHTML(post.attachment)}" controls style="width: 100%;"></audio></div>`;
        } else {
          attachmentHTML = `
            <div style="margin: 10px 0; background: var(--item-hover-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color);">
              <a href="${escapeHTML(post.attachment)}" target="_blank" download style="color: var(--text-color); font-weight: bold; text-decoration: none; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-file-arrow-down" style="color: var(--color-red); font-size: 18px;"></i> ${escapeHTML(post.attachmentName || 'Download File Attachment')}
              </a>
            </div>`;
        }
      }

      return `
        <div class="card post-card" id="post-${post.id}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="openUserProfile('${post.uid}')">
              <div class="avatar profile-avatar" style="${post.authorAvatarUrl ? `background-image: url('${post.authorAvatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${post.authorAvatarUrl ? '' : getInitials(post.author)}</div>
              <div>
                <strong style="font-size: 14px; display: block;">${escapeHTML(post.author || 'Member')}</strong>
                <span style="font-size: 11px; opacity: 0.6;"><i class="fa-regular fa-clock"></i> ${escapeHTML(displayTime)} ${post.isEdited ? '(edited)' : ''}</span>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="toggleBookmark(this, '${post.id}')" title="Bookmark Post">
                <i class="fa-${isBookmarked ? 'solid' : 'regular'} fa-bookmark"></i>
              </button>
              ${isOwner ? `
                <button onclick="toggleEditPost('${post.id}')" style="background: none; border: none; cursor: pointer; color: var(--text-color); opacity: 0.7;" title="Edit Post"><i class="fa-solid fa-pen"></i></button>
                <button onclick="deletePost('${post.id}')" style="background: none; border: none; cursor: pointer; color: var(--color-red);" title="Delete Post"><i class="fa-solid fa-trash"></i></button>
              ` : ''}
            </div>
          </div>

          <div id="postContent-${post.id}">
            ${post.content ? `<p style="font-size: 14px; line-height: 1.5; margin-bottom: 10px; white-space: pre-wrap;">${escapeHTML(post.content)}</p>` : ''}
          </div>

          <div id="editPostContainer-${post.id}" class="hidden" style="margin-bottom: 10px;">
            <textarea id="editPostInput-${post.id}" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); font-size: 13px;" rows="3">${escapeHTML(post.content || '')}</textarea>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px;">
              <button onclick="toggleEditPost('${post.id}')" style="padding: 4px 10px; font-size: 12px; background: transparent; border: 1px solid var(--border-color); color: var(--text-color); border-radius: 4px; cursor: pointer;">Cancel</button>
              <button onclick="saveEditPost('${post.id}')" class="post-btn" style="padding: 4px 12px; font-size: 12px;">Save</button>
            </div>
          </div>

          ${attachmentHTML}

          <div style="display: flex; gap: 15px; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 10px; font-size: 13px;">
            <button onclick="toggleLike('${post.id}')" style="background: none; border: none; cursor: pointer; color: ${isLiked ? 'var(--color-red)' : 'var(--text-color)'}; font-weight: ${isLiked ? 'bold' : 'normal'}; display: flex; align-items: center; gap: 5px;">
              <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i> ${likesCount}
            </button>
            <button onclick="toggleDislike('${post.id}')" style="background: none; border: none; cursor: pointer; color: ${isDisliked ? 'var(--color-red)' : 'var(--text-color)'}; font-weight: ${isDisliked ? 'bold' : 'normal'}; display: flex; align-items: center; gap: 5px;">
              <i class="fa-${isDisliked ? 'solid' : 'regular'} fa-thumbs-down"></i> ${dislikesCount}
            </button>
            <button onclick="toggleCommentSection('${post.id}')" style="background: none; border: none; cursor: pointer; color: var(--text-color); display: flex; align-items: center; gap: 5px;">
              <i class="fa-regular fa-comment"></i> ${commentCount}
            </button>
          </div>

          <div id="commentSection-${post.id}" class="hidden" style="margin-top: 12px; border-top: 1px dashed var(--border-color); padding-top: 10px;">
            <div style="margin-bottom: 10px;">${commentsListHTML}</div>
            <div style="display: flex; gap: 6px;">
              <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); font-size: 12px;" onkeypress="if(event.key==='Enter') addComment('${post.id}')" />
              <button onclick="addComment('${post.id}')" class="post-btn" style="padding: 6px 12px; font-size: 12px;">Reply</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function setupPreviewContainers() {
    const postBox = document.getElementById('postBox');
    if (postBox && !document.getElementById('postPreviewContainer')) {
      const container = document.createElement('div');
      container.id = 'postPreviewContainer';
      container.style.cssText = 'display: none; margin-top: 10px; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color); background: #000; padding: 5px;';
      
      container.innerHTML = `
        <button type="button" id="clearPostPreviewBtn" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; z-index: 10;"><i class="fa-solid fa-xmark"></i></button>
        <img id="postPreviewImg" style="display: none; max-width: 100%; max-height: 200px; margin: 0 auto; object-fit: contain;" />
        <video id="postPreviewVid" controls style="display: none; width: 100%; max-height: 200px;"></video>
        <audio id="postPreviewAud" controls style="display: none; width: 100%; margin-top: 25px;"></audio>
        <div id="postPreviewFile" style="display: none; color: white; padding: 10px; font-size: 12px; word-break: break-all;"></div>
      `;
      postBox.appendChild(container);

      document.getElementById('clearPostPreviewBtn')?.addEventListener('click', clearPostPreview);
    }

    const chatInputRow = document.querySelector('.chat-input-row');
    if (chatInputRow && !document.getElementById('chatPreviewContainer')) {
      const container = document.createElement('div');
      container.id = 'chatPreviewContainer';
      container.style.cssText = 'display: none; padding: 6px 12px; background: var(--item-hover-bg); border-top: 1px solid var(--border-color); align-items: center; justify-content: space-between; font-size: 11px;';
      
      container.innerHTML = `
        <span id="chatPreviewText" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
        <button type="button" id="clearChatPreviewBtn" style="background: none; border: none; color: var(--color-red); cursor: pointer; font-size: 14px;"><i class="fa-solid fa-xmark"></i></button>
      `;
      chatInputRow.parentNode.insertBefore(container, chatInputRow);

      document.getElementById('clearChatPreviewBtn')?.addEventListener('click', clearChatPreview);
    }
  }

  function clearPostPreview() {
    currentPostFile = null;
    const previewContainer = document.getElementById('postPreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
    if (elements.postPhotoInput) elements.postPhotoInput.value = '';
    if (elements.postFileInput) elements.postFileInput.value = '';
  }

  function clearChatPreview() {
    currentChatFile = null;
    const chatPreviewContainer = document.getElementById('chatPreviewContainer');
    if (chatPreviewContainer) chatPreviewContainer.style.display = 'none';
    if (elements.chatFileInput) elements.chatFileInput.value = '';
  }

  init();
});